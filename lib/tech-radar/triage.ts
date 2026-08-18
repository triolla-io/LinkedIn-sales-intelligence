/**
 * Stage 2: the shared launch filter.
 *
 * Company-agnostic and therefore run ONCE per pool item rather than once per
 * company — the second half of the cost story. Its job is the question the
 * existing Fintech Radar never asks: is this a technology someone could adopt,
 * or is it market commentary? That missing filter is why the old feed reads
 * like a news digest.
 *
 * Chunked deliberately: a single LLM call over ~100 items truncates its JSON
 * output and silently yields ZERO results. See lib/fintech-radar/extract.ts,
 * where this was learned the hard way.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE, TRIAGE_CHUNK_SIZE, type TriageVerdict } from "@/lib/tech-radar/types";

export type PoolItem = { title: string; url: string; snippet: string; publishedAt: string | null };

/**
 * Output budget per item being judged. A flat 1800 was not enough for a 25-item chunk:
 * the first live run came back finish_reason="length", cut off mid-verdict, and the
 * whole chunk parsed to zero. One verdict costs ~70 output tokens, so 140 leaves real
 * headroom — and output tokens are the cheap half of the bill.
 */
const TOKENS_PER_ITEM = 140;
const TOKENS_OVERHEAD = 300;

export function triageMaxTokens(itemCount: number): number {
  return TOKENS_OVERHEAD + itemCount * TOKENS_PER_ITEM;
}

const SYSTEM = `You screen news items and decide which ones describe a NEW TECHNOLOGY that a company could actually adopt.

Answer isLaunch=true ONLY for: a new product, a new feature or capability of an existing product, a platform or API release, a new technology or standard becoming available, or a major version launch.

Answer isLaunch=false for everything else, including:
- funding rounds, valuations, investment news
- acquisitions, mergers, IPOs
- executive appointments, hires, departures, layoffs
- market analysis, forecasts, surveys, research reports, rankings
- opinion, commentary, interviews, predictions
- partnership announcements with no new capability
- listicles ("top 10 ..."), event and conference coverage
- regulatory news, unless a concrete new technical standard or scheme is being launched

Also be strict about substance: if the item is too vague to explain what the technology does, isLaunch=false.

For each item also return:
- categories: 2-5 short lowercase topical tags describing the capability area (e.g. "fraud detection", "payments", "core banking", "identity verification", "data infrastructure"). These are matched against a company's focus areas later, so use plain descriptive nouns, not marketing words.
- vendor: the organisation that launched it, or null.
- technology: the concrete name of the thing launched, or null.

Return strict JSON only — no prose, no fences. Include EVERY input url exactly once:
{"verdicts":[{"url":"<the url>","isLaunch":true,"categories":["..."],"vendor":"...","technology":"..."}]}`;

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
      isLaunch: o.isLaunch === true,
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
