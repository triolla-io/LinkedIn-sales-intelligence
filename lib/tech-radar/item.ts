/**
 * Stage 3: the shared TechItem write-up.
 *
 * Written ONCE per item and reused by everyone it fits, because
 * "what did Stripe launch and what does it do" is not a per-customer question.
 * Only the fit rationale (stage 4) is per-company.
 *
 * makeItemDedupeKey is what stops the feed filling with triplets: it keys on
 * normalized vendor + technology, NOT on url, so one launch covered by three
 * outlets collapses into a single row.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE, type TechItemDraft, type TriageVerdict } from "@/lib/tech-radar/types";

/** Total characters of page text handed to the model — a huge page must not blow the context. */
const MAX_PROMPT_TEXT = 14_000;

const CORPORATE_SUFFIX = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|plc|gmbh|ag|sa|nv|bv|co|company|group|holdings)\b/g;
const FILLER_WORDS = /\b(the|a|an|new|newly|introducing|introduces|announce|announces|announced|announcement|launch|launches|launched|unveils|unveiled|release|releases|released)\b/g;
const TRAILING_GENERIC = /\b(platform|solution|solutions|service|services|suite|product|tool|toolkit|api|sdk|system)$/;

function normalizeKeyPart(s: string): string {
  let out = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Dots go FIRST, with no separator: "N.V." -> "nv" and "Inc." -> "inc" so the
    // corporate-suffix list can match them. Turning them into spaces instead would
    // leave "n v", which matches nothing.
    .replace(/\./g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(CORPORATE_SUFFIX, " ")
    .replace(FILLER_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop only a TRAILING generic noun: "radar assistant platform" == "radar assistant",
  // but a technology actually named "platform" keeps its single token.
  const stripped = out.replace(TRAILING_GENERIC, "").trim();
  if (stripped) out = stripped;
  // Singularise, so "Automated Background Checks" and "Automated Background Check
  // System" land on the same key — the live run stored that launch twice. Words ending
  // in "ss" ("access") or "is" ("analysis") are left alone.
  out = out
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !/(ss|is|us)$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Vendor tokens sorted, so a jointly-announced launch keys the same however the two
 * parties are ordered: two outlets wrote "GHG Protocol and ISO" and "ISO and GHG
 * Protocol", and the live run stored that announcement twice.
 */
function normalizeVendorKey(vendor: string): string {
  const normalized = normalizeKeyPart(vendor).replace(/\b(and|&)\b/g, " ").replace(/\s+/g, " ").trim();
  return normalized.split(" ").filter(Boolean).sort().join(" ");
}

/** Meaningful tokens of a technology name, for comparing two phrasings of one thing. */
function technologyTokens(technology: string): Set<string> {
  return new Set(
    normalizeKeyPart(technology)
      .split(" ")
      .filter((t) => t.length > 2)
  );
}

/** Overlap above which two names are treated as the same technology. */
const SAME_TECHNOLOGY_OVERLAP = 0.6;
/** Below this many tokens, overlap is noise — "Qore" and "Vulcan" must stay apart. */
const MIN_TOKENS_FOR_OVERLAP = 3;

/**
 * True when two technology names describe the same thing. Exact after normalising, or
 * a high token overlap — "Unified Corporate Greenhouse Gas Accounting Standard" and
 * "Unified Corporate Carbon Accounting Standard" are one announcement, one word apart.
 */
export function isSameTechnology(a: string, b: string): boolean {
  const left = normalizeKeyPart(a ?? "");
  const right = normalizeKeyPart(b ?? "");
  if (!left || !right) return false;
  if (left === right) return true;

  const la = technologyTokens(a);
  const lb = technologyTokens(b);
  // Short names carry too little signal for overlap to mean anything.
  if (la.size < MIN_TOKENS_FOR_OVERLAP || lb.size < MIN_TOKENS_FOR_OVERLAP) return false;

  let shared = 0;
  for (const t of la) if (lb.has(t)) shared += 1;
  return shared / Math.max(la.size, lb.size) >= SAME_TECHNOLOGY_OVERLAP;
}

/** Categories are specific enough that an identical set is evidence, not coincidence. */
const SAME_CATEGORIES_OVERLAP = 0.75;
/** Below this, a shared set is just two broad tags like "payments, api". */
const MIN_CATEGORIES_FOR_OVERLAP = 3;

/**
 * True when two write-ups describe the same launch, for items already known to come from
 * the same vendor.
 *
 * Name overlap alone is not enough: two outlets covered TGS's seismic AI launch as "TGS
 * Seismic Foundation Model" and "AI Model for Subsurface Interpretation", which share
 * only the word "model" — but both produced the same four specific categories. Either
 * signal on its own is sufficient; neither fires on two genuinely different products.
 */
export function isSameLaunch(
  a: { technology: string; categories: string[] },
  b: { technology: string; categories: string[] }
): boolean {
  if (isSameTechnology(a.technology, b.technology)) return true;

  const norm = (cs: string[]) => new Set(cs.map((c) => c.toLowerCase().trim()).filter(Boolean));
  const ca = norm(a.categories ?? []);
  const cb = norm(b.categories ?? []);
  if (ca.size < MIN_CATEGORIES_FOR_OVERLAP || cb.size < MIN_CATEGORIES_FOR_OVERLAP) return false;

  let shared = 0;
  for (const c of ca) if (cb.has(c)) shared += 1;
  return shared / Math.max(ca.size, cb.size) >= SAME_CATEGORIES_OVERLAP;
}

export function makeItemDedupeKey(vendor: string | null, technology: string): string {
  const v = normalizeVendorKey(vendor ?? "");
  let t = normalizeKeyPart(technology ?? "");
  // Coverage often names the vendor inside the technology ("Plaid announces Layer"),
  // while the vendor's own page just says "Layer". Same launch — same key. Compared
  // against the UNSORTED vendor, since that is how the name appears in the sentence.
  const spoken = normalizeKeyPart(vendor ?? "");
  if (spoken && t !== spoken && t.startsWith(`${spoken} `)) t = t.slice(spoken.length + 1).trim();
  return v ? `${v}::${t}` : `::${t}`;
}

const SYSTEM = `You write a short, factual, neutral description of ONE news item, for an Israeli professional audience who read it in Hebrew.

The item may be a research finding, a trend, a report, a piece of significant news, a move by a company, or a product launch. Describe what it actually SAYS.

- If it reports a finding or a number, name the finding and the number.
- If it describes a trend, say what is changing and what the evidence is.
- If it concerns a company, say what that company did.
- If it is a product, say what it is and what it does.

Do NOT speculate about whether it suits any particular person, company or industry — a later step decides that. No marketing language, no hype, no adjectives like "revolutionary" or "game-changing". Do not recommend anything.

Return strict JSON only — no prose, no fences:
{"vendor": string or null, "subject": string, "title": string, "summary": string, "categories": ["..."]}

- subject: what the item is ABOUT, in a few words. For a product this is its name ("Stripe Radar"). For research or a trend it is the topic ("מרווחי זיקוק בארה\"ב", "אימוץ מסדי וקטורים"). REQUIRED — never null.
- vendor: the organisation the item concerns, or null. Many research items have none, and null is the correct answer then — do not invent one.
- Names stay in their ORIGINAL script. Do not translate or transliterate a product or company name — "Stripe Radar" stays "Stripe Radar", never "סטרייפ ראדאר".
- title: one short factual headline IN HEBREW, max ~90 characters. Product and company names stay verbatim inside it.
- summary: 2-4 sentences IN HEBREW, everyday professional Hebrew. Technical terms with no settled Hebrew form stay in English (API, machine learning, CDP).
- categories: 2-5 short lowercase capability or topic tags, IN ENGLISH — they are matched against English data downstream, so they must not be translated.`;

export type ItemSynthesisInput = {
  triage: TriageVerdict;
  articles: { url: string; title: string; snippet: string; publishedAt: string | null }[];
  /** Real page text: the article page and, when found, the vendor's product page. */
  pages: { url: string; title: string | null; text: string }[];
};

function userPrompt(input: ItemSynthesisInput): string {
  const head = [
    input.triage.vendor ? `Likely vendor: ${input.triage.vendor}` : null,
    input.triage.technology ? `Likely subject: ${input.triage.technology}` : null,
    input.triage.kind ? `Kind: ${input.triage.kind}` : null,
    `Tags: ${input.triage.categories.join(", ") || "n/a"}`,
    ``,
    `Coverage:`,
    ...input.articles.map((a) => `- ${a.title} (${a.url})\n  ${(a.snippet ?? "").slice(0, 300)}`),
  ]
    .filter((l) => l !== null)
    .join("\n");

  if (input.pages.length === 0) return `${head}\n\n(No page content could be retrieved.)`;

  // Share the text budget across pages so one long page cannot crowd out the others.
  const perPage = Math.max(1000, Math.floor(MAX_PROMPT_TEXT / input.pages.length));
  const body = input.pages
    .map((p) => `--- ${p.title ?? p.url} (${p.url}) ---\n${p.text.slice(0, perPage)}`)
    .join("\n\n");
  return `${head}\n\nPage content:\n${body}`;
}

/**
 * The write-up model produces prose, not scores. `shareworthy` and `kind` come from the
 * triage verdict and are excluded here on purpose: letting this stage return them would
 * give one item two scores that can disagree, and the stored one is what a discard is
 * explained by.
 */
export function parseItemResponse(
  text: string
): Omit<TechItemDraft, "sources" | "thin" | "shareworthy" | "stature" | "kind"> | null {
  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return null;

  // `subject` replaced `technology`. The old field demanded the name of a launched
  // product, and the inverted triage now brings research and trends, which have no
  // product — eight of eleven write-ups failed to parse on 2026-08-23 for exactly that
  // reason. `technology` is still read as a fallback so an older response still parses.
  const technology = String(parsed.subject ?? parsed.technology ?? "").trim();
  const summary = String(parsed.summary ?? "").trim();
  if (!technology || !summary) return null;

  const vendorRaw = typeof parsed.vendor === "string" ? parsed.vendor.trim() : "";
  const titleRaw = String(parsed.title ?? "").trim();
  const categories = Array.isArray(parsed.categories)
    ? [...new Set(
        parsed.categories
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.toLowerCase().trim())
          .filter(Boolean)
      )]
    : [];

  return {
    vendor: vendorRaw || null,
    technology,
    title: titleRaw || technology,
    summary,
    categories,
    publishedAt: null,
  };
}

export async function synthesizeItem(input: ItemSynthesisInput): Promise<TechItemDraft> {
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.item,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(input) },
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 35_000 }
  );
  if (!res.ok) throw new Error(`tech-radar item synthesis failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  const parsed = parseItemResponse(text);
  if (!parsed) throw new Error("tech-radar item synthesis returned unparseable output");

  // Sources and dates come from the real coverage, never from model output.
  const sources = input.articles.map((a) => ({
    url: a.url,
    title: a.title,
    publishedAt: a.publishedAt,
  }));
  const publishedAt = input.articles.map((a) => a.publishedAt).find((d) => !!d) ?? null;

  return {
    ...parsed,
    publishedAt,
    sources,
    thin: input.pages.length === 0,
    // Carried from the verdict, not re-judged. Re-scoring here would give one item two
    // scores that could disagree, and the stored one is what a discard is explained by.
    shareworthy: input.triage.shareworthy,
    stature: input.triage.stature,
    kind: input.triage.kind,
  };
}
