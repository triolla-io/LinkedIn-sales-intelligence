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
 * One entry of an industry pack's closed taxonomy (`RadarSourcePack.taxonomy`).
 *
 * Structural on purpose so a pack row can be handed straight in without triage.ts
 * importing the pack module — this file is imported by the company path too, and by
 * scripts that have no pack at all.
 */
export type TaxonomyTag = { tag: string; label?: string | null };

/**
 * Output budget per item being judged. A flat 1800 was not enough for a 25-item chunk:
 * the first live run came back finish_reason="length", cut off mid-verdict, and the
 * whole chunk parsed to zero. A shareworthy verdict carries three more fields than the
 * old isLaunch one, so 200 rather than 140 — output tokens are the cheap half of the
 * bill and a truncated chunk costs the whole chunk.
 *
 * Raised 230 -> 290 when `industryTags` was added (v3 Phase B): a fourth array field
 * per verdict, up to MAX_INDUSTRY_TAGS_PER_ITEM Hebrew tags, and Hebrew costs more
 * tokens per character than English. The same truncation arithmetic applies — the
 * budget is charged per chunk whether the chunk parses or not, so under-budgeting is
 * the expensive mistake, not over-budgeting.
 */
const TOKENS_PER_ITEM = 290;
const TOKENS_OVERHEAD = 300;

/**
 * Tags kept per item, in the order the model returned them (its own confidence order).
 *
 * Not cosmetic: Task 6's broad-tier floor asks for >=2 broad tags before an item may
 * reach a person on industry tags alone. A model that sprays ten recognised tags onto
 * every article satisfies that floor for everyone and deletes it in practice.
 */
export const MAX_INDUSTRY_TAGS_PER_ITEM = 4;

export function triageMaxTokens(itemCount: number): number {
  return TOKENS_OVERHEAD + itemCount * TOKENS_PER_ITEM;
}

export const SYSTEM = `You decide whether a news item is worth FORWARDING to a senior professional you know personally — the way someone sends a colleague a link with "saw this, thought of you".

The test is not "is this new" and not "is this relevant to their industry". It is: would a well-read person send this unprompted, with nothing to gain?

Score TWO separate things, both as DECIMALS from 0 to 1. Never a word, never a percentage.

\`shareworthy\` — is this the kind of thing a person forwards at all?
\`stature\` — how much WEIGHT does it carry? These are different questions and a high answer to one does not imply the other.

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
- "Amazon DynamoDB now supports real-time vector search at any scale", published on aws.amazon.com → kind "vendor_launch", shareworthy 0.2, stature 0.2. AWS announcing an AWS feature on the AWS blog.
- "Research: 60% of data teams dropped their separate vector database in 2026", published by an independent report → kind "research", shareworthy 0.8, stature 0.7. A finding someone would actually send.
- "Robotic phased-array ultrasonic inspection for unpiggable offshore pipelines", in a pipeline trade journal → kind "trend", shareworthy 0.7, stature 0.2. Correct subject for an asset manager, and no gift in it: one niche instrument in a trade paper.
- "ועדת הריכוזיות המליצה: לא לאשר לשפיר לרכוש את בז\"א" in Globes → kind "big_news", shareworthy 0.9, stature 0.9. A regulator blocking an acquisition in their own market.

STATURE — the weight of the thing, independent of how relevant it is:

HIGH (0.7-1.0):
- a flagship report or study from a major consultancy or analyst house (McKinsey, BCG, Deloitte, PwC, EY, KPMG, Gartner, Forrester, WEF, IEA, IMF, OECD)
- a large-scale survey with a named sponsor
- a regulatory or legislative move with real consequences — a ruling, a mandate, an exemption, an antitrust decision
- a large market move — a major acquisition, a price threshold crossed, a listed company's results
- national or sector-level news in a serious business publication

LOW (0.0-0.3):
- a write-up of one niche tool, method or instrument in a trade publication
- a single narrow academic paper on a technique
- a vendor's own material, whatever its subject

The test is: WOULD A CEO FORWARD THIS TO ANOTHER CEO? Not "is this about their field".

A paper on a polymer that improves CO2 injection efficiency is squarely on-topic for an oil executive and still has no gift in it — stature LOW. A regulator granting biofuel-mandate exemptions to refiners is the same field and is a gift — stature HIGH.

Set \`staleness\` true when the item is something everyone in the field already saw — forwarding it says "I do not follow your field".

Return for each item:
- shareworthy: decimal 0-1
- stature: decimal 0-1
- kind: exactly one of "research", "trend", "big_news", "company_move", "vendor_launch", "promotion", "other"
- publisher: the site or organisation that published it, or null
- staleness: true or false
- israelRelevant: true when the item is ABOUT the Israeli market, Israeli regulation, or an Israeli company — regardless of who published it. An international outlet reporting that an Israeli bank will offer crypto trading IS israelRelevant. A story about Greek banks or Indian securities regulation is NOT, even if the subject matter is identical.
- categories: 2-5 short lowercase topical tags naming the capability or subject area (e.g. "fraud detection", "payments", "core banking", "identity verification", "data infrastructure"). Plain descriptive nouns, not marketing words — they are matched against a person's interests later.
- industryTags: ONLY when the user message carries a TAXONOMY block. Then pick the entries from THAT LIST that this item is actually about — copied character for character from the left of the dash. Never invent a tag, never translate one, never send a label instead of its tag: a value that is not on the list is discarded, so it buys nothing. An item that fits nothing on the list gets an empty array; that is a correct answer, not a failure. When there is no TAXONOMY block, omit the key.
- vendor: the organisation the item is ABOUT, or null
- technology: the concrete name of the thing, or null

Return strict JSON only — no prose, no fences. Include EVERY input url exactly once:
{"verdicts":[{"url":"<the url>","shareworthy":0.2,"stature":0.2,"kind":"vendor_launch","publisher":"aws.amazon.com","staleness":false,"israelRelevant":false,"categories":["..."],"vendor":"Amazon","technology":"..."}]}`;

/**
 * The closed list, in the USER message rather than in SYSTEM: it changes per industry
 * pack, while SYSTEM is one shared constant for every org. An empty or missing taxonomy
 * renders NOTHING — the company-outward path (scan.ts -> fit.ts) must send the exact
 * prompt it sent before Phase B, or its cost and its behaviour both move for no reason.
 */
function taxonomyBlock(taxonomy?: readonly TaxonomyTag[]): string {
  if (!taxonomy || taxonomy.length === 0) return "";
  const lines = taxonomy
    .map((t) => `- ${t.tag}${t.label ? ` — ${t.label}` : ""}`)
    .join("\n");
  return `TAXONOMY — a CLOSED list of ${taxonomy.length} industry tags. \`industryTags\` may contain ONLY values copied verbatim from the left of the dash, at most ${MAX_INDUSTRY_TAGS_PER_ITEM} per item, [] when nothing on the list fits:
${lines}

EVERY verdict you return MUST carry an \`industryTags\` array, next to \`categories\`:
{"url":"...","categories":["..."],"industryTags":["<a tag copied from the list above>"],"vendor":null}
The example in the system message omits that key because it shows the no-taxonomy case. Here it is required — [] is the right answer when nothing on the list fits, a missing key is not.

ITEMS:
`;
}

function userPrompt(items: PoolItem[], taxonomy?: readonly TaxonomyTag[]): string {
  return taxonomyBlock(taxonomy) + items
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

/** Lookup key for the closed list. Hebrew has no case, but the English half of a
 *  bilingual taxonomy does, and a model re-typing a tag adds and drops spaces. */
function tagKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Same discipline as `asKind`, one step stricter: an off-list tag is DROPPED, never
 * mapped onto the nearest member.
 *
 * A coerced tag is worse than a missing one. `אשראי` is not `אשראי-צרכני`, and a
 * near-miss snapped onto a real tag puts an article in front of a person on a
 * judgement no model ever made — untraceable in the decision trail, and it poisons the
 * calibration evidence Task 7 exists to collect. The one thing that IS canonicalised
 * is spelling: a match returns the taxonomy's own string, never the model's typing,
 * because the person side subscribes by that exact value.
 */
function industryTagsFrom(v: unknown, allowed: Map<string, string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const canonical = allowed.get(tagKey(raw));
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= MAX_INDUSTRY_TAGS_PER_ITEM) break;
  }
  return out;
}

/**
 * Pure. Hallucinated urls are dropped: the model inventing rows is a real failure mode.
 *
 * `taxonomy` omitted leaves `industryTags` off the verdict entirely rather than setting
 * it to [] — see the field's note in types.ts: "no pack was offered" and "a pack was
 * offered and nothing matched" are different findings and only one of them is evidence
 * about the taxonomy.
 */
export function parseTriageResponse(
  text: string,
  validUrls: Set<string>,
  taxonomy?: readonly TaxonomyTag[]
): TriageVerdict[] {
  const allowed = new Map<string, string>();
  for (const t of taxonomy ?? []) {
    const tag = typeof t?.tag === "string" ? t.tag.trim() : "";
    if (tag) allowed.set(tagKey(tag), tag);
  }
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
      stature: clampScore(o.stature),
      kind: asKind(o.kind),
      publisher: str(o.publisher),
      // This is the model's judgement that the IDEA is old news to insiders — a
      // brand-new article rehashing a stale idea is still staleness=true. It is
      // unrelated to the hard 30-day publish-date gate in freshness.ts, which runs
      // on the pool before it ever reaches triage; that gate does not make this
      // field redundant, and neither makes the other unnecessary.
      staleness: o.staleness === true,
      // Absent means false: a missing field must never be read as "yes, Israel-relevant",
      // or a model that forgets the key would silently satisfy the acceptance bar.
      israelRelevant: o.israelRelevant === true,
      categories,
      ...(taxonomy ? { industryTags: industryTagsFrom(o.industryTags, allowed) } : {}),
      technology: str(o.technology),
      vendor: str(o.vendor),
    });
  }
  return out;
}

export async function triageChunk(
  items: PoolItem[],
  taxonomy?: readonly TaxonomyTag[]
): Promise<TriageVerdict[]> {
  if (items.length === 0) return [];
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.triage,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(items, taxonomy) },
      ],
      temperature: 0.1,
      max_tokens: triageMaxTokens(items.length),
      response_format: { type: "json_object" },
    },
    // 30s aborted EVERY chunk once `stature` was added: a 25-item chunk now asks for
    // ~6,000 output tokens (300 + 25x230) and generating that does not finish in 30s.
    // The whole chunk is lost on a timeout, so the ceiling has to fit the work.
    { timeoutMs: 120_000 }
  );
  if (!res.ok) throw new Error(`tech-radar triage failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  return parseTriageResponse(text, new Set(items.map((i) => i.url)), taxonomy);
}

/**
 * Triage the whole pool in chunks. A failing chunk is logged and skipped rather
 * than aborting the run — losing 25 verdicts is far better than losing 150.
 */
export async function triageAll(
  items: PoolItem[],
  taxonomy?: readonly TaxonomyTag[]
): Promise<TriageVerdict[]> {
  const merged = new Map<string, TriageVerdict>();
  for (let i = 0; i < items.length; i += TRIAGE_CHUNK_SIZE) {
    const chunk = items.slice(i, i + TRIAGE_CHUNK_SIZE);
    try {
      for (const v of await triageChunk(chunk, taxonomy)) {
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
