/**
 * Stage 2: the shared shareworthiness filter.
 *
 * Company-agnostic and therefore run ONCE per pool item rather than once per
 * company — the second half of the cost story. The question it asks is the whole
 * feature: would a well-read person forward this to someone they know, unprompted,
 * with no agenda?
 *
 * It used to ask "is this a technology someone could adopt?" and reject research,
 * surveys, analysis and commentary outright. That is the inverse of what a
 * relationship radar wants, and it is why the first production run (2026-08-20)
 * returned eleven vendor launches and nothing else.
 *
 * Chunked deliberately: a single LLM call over ~100 items truncates its JSON
 * output and silently yields ZERO results. See lib/fintech-radar/extract.ts,
 * where this was learned the hard way.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import {
  OR_FEATURE,
  TRIAGE_CHUNK_SIZE,
  ITEM_KINDS,
  type ItemKind,
  type TriageVerdict,
} from "@/lib/tech-radar/types";

export type PoolItem = { title: string; url: string; snippet: string; publishedAt: string | null };

/**
 * Output budget per item being judged. A flat 1800 was not enough for a 25-item chunk:
 * the first live run came back finish_reason="length", cut off mid-verdict, and the
 * whole chunk parsed to zero. A shareworthy verdict carries three more fields than the
 * old isLaunch one, so 200 rather than 140 — output tokens are the cheap half of the
 * bill and a truncated chunk costs the whole chunk.
 */
const TOKENS_PER_ITEM = 200;
const TOKENS_OVERHEAD = 300;

export function triageMaxTokens(itemCount: number): number {
  return TOKENS_OVERHEAD + itemCount * TOKENS_PER_ITEM;
}

export const SYSTEM = `You decide whether a news item is worth FORWARDING to a senior professional you know personally — the way someone sends a colleague a link with "saw this, thought of you".

The test is not "is this new" and not "is this relevant to their industry". It is: would a well-read person send this unprompted, with nothing to gain?

Score \`shareworthy\` from 0 to 1, as a DECIMAL. Never a word, never a percentage.

HIGH (0.6-1.0):
- research, reports and surveys with actual findings or numbers
- a genuine trend, with evidence that it is happening
- big news in the recipient's world — a major shift, a regulatory change with teeth, a market event
- a move by a company the recipient is connected to

LOW (0.0-0.4):
- a vendor announcing its own product, feature, capability, platform or version. This is marketing that happens to be true. Score it low EVEN IF the technology is genuinely useful and genuinely new.
- press releases, sponsored content, "we are excited to announce"
- listicles, event coverage, opinion with no evidence
- anything too vague to say what actually happened

The single most important signal is \`publisher\` versus \`vendor\`. When the organisation that published the item is the organisation the item is about, it is PROMOTION until proven otherwise. A vendor launch rises above 0.6 only when a THIRD PARTY adds an angle the vendor did not: independent analysis, adoption data, a comparison, or evidence of a wider trend.

Worked examples:
- "Amazon DynamoDB now supports real-time vector search at any scale", published on aws.amazon.com → kind "vendor_launch", shareworthy 0.2. AWS announcing an AWS feature on the AWS blog. Useful, not forwardable.
- "Research: 60% of data teams dropped their separate vector database in 2026", published by an independent report → kind "research", shareworthy 0.8. Same subject, a finding someone would actually send.

Set \`staleness\` true when the item is something everyone in the field already saw — forwarding it says "I do not follow your field".

Return for each item:
- shareworthy: decimal 0-1
- kind: exactly one of "research", "trend", "big_news", "company_move", "vendor_launch", "promotion", "other"
- publisher: the site or organisation that published it, or null
- staleness: true or false
- categories: 2-5 short lowercase topical tags naming the capability or subject area (e.g. "fraud detection", "payments", "core banking", "identity verification", "data infrastructure"). Plain descriptive nouns, not marketing words — they are matched against a person's interests later.
- vendor: the organisation the item is ABOUT, or null
- technology: the concrete name of the thing, or null

Return strict JSON only — no prose, no fences. Include EVERY input url exactly once:
{"verdicts":[{"url":"<the url>","shareworthy":0.2,"kind":"vendor_launch","publisher":"aws.amazon.com","staleness":false,"categories":["..."],"vendor":"Amazon","technology":"..."}]}`;

function userPrompt(items: PoolItem[]): string {
  return items
    .map(
      (i, n) =>
        `${n + 1}. url=${i.url}\n   title: ${i.title}\n   snippet: ${(i.snippet ?? "").slice(0, 400)}${
          i.publishedAt ? `\n   published: ${i.publishedAt}` : ""
        }`
    )
    .join("\n");
}

/**
 * Anything we cannot trust scores zero — the safe end. A model answering 8 instead of
 * 0.8, or "very high", must not become a top hit: an unscored item skipped is
 * recoverable, an unscored item sent is not.
 */
function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

/** An unrecognised kind becomes "other", never a kind that carries a policy. */
function asKind(v: unknown): ItemKind {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (ITEM_KINDS as readonly string[]).includes(s) ? (s as ItemKind) : "other";
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

/** Pure. Hallucinated urls are dropped: the model inventing rows is a real failure mode. */
export function parseTriageResponse(text: string, validUrls: Set<string>): TriageVerdict[] {
  const parsed = parseJsonLoose<{ verdicts?: unknown }>(text);
  const rows = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  const seen = new Set<string>();
  const out: TriageVerdict[] = [];

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url || !validUrls.has(url) || seen.has(url)) continue;
    seen.add(url);

    const categories = Array.isArray(o.categories)
      ? [...new Set(
          o.categories
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.toLowerCase().trim())
            .filter(Boolean)
        )]
      : [];

    out.push({
      url,
      shareworthy: clampScore(o.shareworthy),
      kind: asKind(o.kind),
      publisher: str(o.publisher),
      staleness: o.staleness === true,
      categories,
      technology: str(o.technology),
      vendor: str(o.vendor),
    });
  }
  return out;
}

export async function triageChunk(items: PoolItem[]): Promise<TriageVerdict[]> {
  if (items.length === 0) return [];
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.triage,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(items) },
      ],
      temperature: 0.1,
      max_tokens: triageMaxTokens(items.length),
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  if (!res.ok) throw new Error(`tech-radar triage failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  return parseTriageResponse(text, new Set(items.map((i) => i.url)));
}

/**
 * Triage the whole pool in chunks. A failing chunk is logged and skipped rather
 * than aborting the run — losing 25 verdicts is far better than losing 150.
 */
export async function triageAll(items: PoolItem[]): Promise<TriageVerdict[]> {
  const merged = new Map<string, TriageVerdict>();
  for (let i = 0; i < items.length; i += TRIAGE_CHUNK_SIZE) {
    const chunk = items.slice(i, i + TRIAGE_CHUNK_SIZE);
    try {
      for (const v of await triageChunk(chunk)) {
        if (!merged.has(v.url)) merged.set(v.url, v);
      }
    } catch (err) {
      console.error(
        `[tech-radar] triage chunk ${i / TRIAGE_CHUNK_SIZE} of ${chunk.length} items failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return [...merged.values()];
}
