/**
 * Per-axis fit: the judgement that flips the direction.
 *
 * v1 asked `judgeFit(companyProfile, item)`, so the answer was a property of the
 * company and was byte-identical for three founders of one company. This asks
 * `judgeAxisFit(axis, item)` — once per pair, shared by every subscriber to that axis.
 * That sharing is what keeps cost flat as the person count grows; the alternative,
 * judging every (person, item) pair, is thousands of calls a day against a $2 cap.
 *
 * The result is candidacy, not a send. The veto still decides whether any particular
 * subscriber hears about it.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

/** Below this an (axis, item) pair is not a candidate for anyone. */
export const AXIS_FIT_FLOOR = 0.5;

export type AxisFitInput = {
  axisLabel: string;
  /** What the axis is about, from the queries that define it. */
  axisQueries: string[];
  item: { title: string; summary: string; technology: string | null; kind?: string };
};

export type AxisFitVerdict = { score: number; rationale: string };

export const AXIS_FIT_SYSTEM = `You judge whether one news item is genuinely about a given subject.

You are given a SUBJECT (an interest someone follows) and an ITEM. Score 0 to 1, as a decimal, how much the item advances someone's understanding of that subject.

Score high only when the item says something a person following this subject did not already know. Score low when:
- the item merely mentions the subject in passing
- the item is about a neighbouring subject that shares vocabulary
- the item restates something obvious to anyone following the subject

Do NOT reward an item for being important in general. A major funding round is important and teaches nothing about a technical subject.

rationale: ONE Hebrew sentence saying what the item adds to this subject. It must be about the SUBJECT and the ITEM — never about any person or company, because this judgement is shared by everyone who follows the subject.

Return strict JSON only:
{"score":0.7,"rationale":"..."}`;

export function parseAxisFit(text: string): AxisFitVerdict {
  const parsed = parseJsonLoose<{ score?: unknown; rationale?: unknown }>(text);
  const raw = typeof parsed?.score === "number" ? parsed.score : Number.NaN;
  // Same rule as triage: an unreadable score is 0, not a guess. A pair that never
  // becomes a candidate is recoverable; one that does on a bad number is not.
  const score = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0;
  const rationale = typeof parsed?.rationale === "string" ? parsed.rationale.trim() : "";
  return { score: rationale ? score : 0, rationale };
}

export async function judgeAxisFit(input: AxisFitInput): Promise<AxisFitVerdict> {
  const res = await openrouterChat(
    OR_FEATURE.axisFit,
    {
      model: MODEL,
      messages: [
        { role: "system", content: AXIS_FIT_SYSTEM },
        {
          role: "user",
          content: [
            `Subject: ${input.axisLabel}`,
            `The subject covers searches like: ${input.axisQueries.join("; ")}`,
            ``,
            `Item: ${input.item.title}`,
            input.item.technology ? `Concerns: ${input.item.technology}` : null,
            input.item.kind ? `Kind: ${input.item.kind}` : null,
            `Summary: ${input.item.summary.slice(0, 800)}`,
          ]
            .filter((l) => l !== null)
            .join("\n"),
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  if (!res.ok) return { score: 0, rationale: "" };
  return parseAxisFit(res.data.choices?.[0]?.message?.content ?? "");
}

export type AxisQuerySubscription = { query: string; axisIds: string[] };

/**
 * The query pool, built from AXES rather than from company profiles. This one function
 * is what makes the run start from people: a company with nobody marked contributes no
 * axis and therefore no query, and can no longer pull the run toward itself.
 *
 * Pure and deterministic, so an Inngest step replay produces the same pool.
 */
export function buildAxisQueryPool(
  axes: { id: string; searchQueries: string[] }[],
  normalize: (q: string) => string,
  maxPerAxis: number
): AxisQuerySubscription[] {
  const pool = new Map<string, { query: string; axisIds: string[] }>();

  for (const axis of axes) {
    const queries = Array.isArray(axis.searchQueries) ? axis.searchQueries : [];
    let used = 0;
    const seenForAxis = new Set<string>();

    for (const raw of queries) {
      if (used >= maxPerAxis) break;
      if (typeof raw !== "string") continue;
      const key = normalize(raw);
      if (!key || seenForAxis.has(key)) continue;
      seenForAxis.add(key);
      used += 1;

      const entry = pool.get(key);
      if (entry) {
        if (!entry.axisIds.includes(axis.id)) entry.axisIds.push(axis.id);
      } else {
        pool.set(key, { query: raw.trim(), axisIds: [axis.id] });
      }
    }
  }

  return [...pool.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => ({ query: v.query, axisIds: [...v.axisIds].sort() }));
}

/**
 * Cap the pool BEFORE triage, spreading the cut across axes.
 *
 * Triage is the dominant cost line and it scales with pool size, not with anything
 * useful. The 2026-08-23 run pulled 677 items from 72 queries — Serper returns ~10 per
 * query and every query can retry broader — and triaging them cost ~$1, over half the
 * daily budget, for 30 survivors. The estimate had assumed 150.
 *
 * Round-robin by axis so the cut never starves one interest: every axis contributes its
 * best item before any axis contributes a second. Cutting by arrival order instead would
 * hand the whole budget to whichever queries happened to run first.
 *
 * Pure and deterministic, so an Inngest step replay produces the same pool.
 */
export function capPoolByAxis<T extends { url: string; companyIds: string[] }>(
  items: T[],
  limit: number
): { kept: T[]; dropped: number } {
  if (limit <= 0) return { kept: [], dropped: items.length };
  if (items.length <= limit) return { kept: items, dropped: 0 };

  // Group by first subscribing axis; an item with none shares one bucket rather than
  // claiming a turn of its own.
  const byAxis = new Map<string, T[]>();
  for (const item of items) {
    const key = item.companyIds[0] ?? "";
    const list = byAxis.get(key);
    if (list) list.push(item);
    else byAxis.set(key, [item]);
  }

  const axes = [...byAxis.keys()].sort();
  const kept: T[] = [];
  const seen = new Set<string>();
  for (let round = 0; kept.length < limit; round += 1) {
    let addedThisRound = false;
    for (const axis of axes) {
      if (kept.length >= limit) break;
      const item = byAxis.get(axis)?.[round];
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      kept.push(item);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }

  return { kept, dropped: items.length - kept.length };
}
