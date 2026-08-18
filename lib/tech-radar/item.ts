/**
 * Stage 3: the shared TechItem write-up.
 *
 * Written ONCE per technology and reused by every company it fits, because
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

export function makeItemDedupeKey(vendor: string | null, technology: string): string {
  const v = normalizeKeyPart(vendor ?? "");
  let t = normalizeKeyPart(technology ?? "");
  // Coverage often names the vendor inside the technology ("Plaid announces Layer"),
  // while the vendor's own page just says "Layer". Same launch — same key.
  if (v && t !== v && t.startsWith(`${v} `)) t = t.slice(v.length + 1).trim();
  return v ? `${v}::${t}` : `::${t}`;
}

const SYSTEM = `You write a short, factual, vendor-neutral description of ONE newly launched technology, for a technical sales audience.

Describe only the technology itself:
- what it is and who launched it
- what it actually does
- what adopting or integrating it involves (prerequisites, where it sits, what it replaces or augments)

Do NOT speculate about whether it suits any particular customer, industry, or company — a later step decides that. No marketing language, no hype, no adjectives like "revolutionary" or "game-changing".

Return strict JSON only — no prose, no fences:
{"vendor": string or null, "technology": string, "title": string, "summary": string, "categories": ["..."]}

- technology: the concrete product/capability name.
- title: one short factual headline, max ~90 characters.
- summary: 2-4 sentences, English.
- categories: 2-5 short lowercase capability tags (plain descriptive nouns).`;

export type ItemSynthesisInput = {
  triage: TriageVerdict;
  articles: { url: string; title: string; snippet: string; publishedAt: string | null }[];
  /** Real page text: the article page and, when found, the vendor's product page. */
  pages: { url: string; title: string | null; text: string }[];
};

function userPrompt(input: ItemSynthesisInput): string {
  const head = [
    input.triage.vendor ? `Likely vendor: ${input.triage.vendor}` : null,
    input.triage.technology ? `Likely technology: ${input.triage.technology}` : null,
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

export function parseItemResponse(text: string): Omit<TechItemDraft, "sources" | "thin"> | null {
  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return null;

  const technology = String(parsed.technology ?? "").trim();
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
  };
}
