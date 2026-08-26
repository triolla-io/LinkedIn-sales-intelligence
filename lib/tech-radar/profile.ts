/**
 * Company research: turn a website and some coverage into a usable profile.
 *
 * The profile's `focusAreas` and `searchQueries` are the point; everything else
 * exists to justify them. Queries are stored rather than recomputed per scan, so
 * they stay stable, are visible on the company screen, and a strange opportunity
 * can be traced back to the query that produced it.
 *
 * Every failure path THROWS. The Inngest caller turns a throw into
 * RESEARCH_FAILED, and a company that is not ACTIVE is never scanned — so a
 * company with an empty profile can never emit random opportunities.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import {
  MAX_QUERIES_PER_COMPANY,
  OR_FEATURE,
  isUsableProfile,
  type TechRadarProfile,
} from "@/lib/tech-radar/types";

/** Total page text handed to the model. */
const MAX_PROFILE_TEXT = 24_000;

export type ProfileResearchInput = {
  companyName: string;
  website: string | null;
  pages: { url: string; title: string | null; text: string }[];
  news: { title: string; url: string; snippet: string }[];
};

// Link text worth following, English and Hebrew. Higher weight = read it sooner.
const LINK_INTENT: { pattern: RegExp; weight: number }[] = [
  { pattern: /\b(products?|product-line)\b|מוצרים|מוצר/i, weight: 5 },
  { pattern: /\b(solutions?|platform)\b|פתרונות|פתרון/i, weight: 5 },
  { pattern: /\b(business|enterprise|corporate|commercial)\b|עסקי|עסקים|מסחרי/i, weight: 4 },
  { pattern: /\b(services?)\b|שירותים|שירות/i, weight: 3 },
  { pattern: /\b(technolog|innovation|developers?|api)\b|טכנולוגיה|חדשנות|מפתחים/i, weight: 3 },
  { pattern: /\b(about|who-we-are|company)\b|אודות|עלינו|אודותינו/i, weight: 2 },
];

const LINK_EXCLUDE =
  /(login|log-in|signin|sign-in|register|careers?|jobs?|privacy|terms|legal|cookie|sitemap|contact|accessibility|press-?releases?\/\d|facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|\.pdf$|\.jpg$|\.png$)/i;

/**
 * Pick same-origin inner pages worth reading, ranked by link-text intent.
 * Pure — the caller does the fetching.
 */
export function pickInnerLinks(html: string, baseUrl: string, limit = 5): string[] {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const scored = new Map<string, number>();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchor)) {
    const [, href, inner] = match;
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    resolved.hash = "";
    const url = resolved.toString();
    if (url.replace(/\/$/, "") === baseUrl.replace(/\/$/, "")) continue;
    if (LINK_EXCLUDE.test(url)) continue;

    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const haystack = `${text} ${resolved.pathname}`;
    if (LINK_EXCLUDE.test(text)) continue;

    let weight = 0;
    for (const intent of LINK_INTENT) if (intent.pattern.test(haystack)) weight = Math.max(weight, intent.weight);
    if (weight === 0) continue;

    scored.set(url, Math.max(scored.get(url) ?? 0, weight));
  }

  return [...scored.entries()]
    .sort(([ua, wa], [ub, wb]) => (wb !== wa ? wb - wa : ua < ub ? -1 : 1))
    .slice(0, limit)
    .map(([url]) => url);
}

const SYSTEM = `You are a B2B technology researcher. Given raw text from a company's own website plus recent coverage, produce a structured profile of what the company actually does.

Three fields are REQUIRED and the research is rejected without them:

- whatTheySell: one plain sentence — what does this company sell, and to whom? Not the mission statement; the actual product and the actual buyer.
- customerSegments: B2C / B2B / B2G, and who the customers actually are. Every company has an answer.
- namedCompetitors: competitors BY NAME — the companies trying to take these customers (for an Israeli insurer that includes insurtech challengers like Lemonade; for one big Israeli bank it is the other big Israeli banks). If, after genuinely looking, there is no direct competitor, return an empty list AND set noClearCompetitors: true with noCompetitorsReason — one sentence saying why (e.g. a state monopoly in its field). That is an active finding, never a default.

The profile's purpose is to drive web searches for NEW technologies, products and launches that this company could adopt. Two fields carry that weight:

- focusAreas: 4-8 concrete capability areas where new technology would matter to THIS company, each with a one-line reason grounded in their business. Not generic industry themes.
- searchQueries: 6-10 ENGLISH web-search queries that would surface newly launched technologies, products, features and platforms relevant to those focus areas. Rules for queries:
  * They search for NEW TECHNOLOGY, not for the company. Never include the company's own name.
  * COVER EVERY BUSINESS LINE. Give each business line at least one query. A diversified
    company must not have all of its queries aimed at one line, or the rest of the
    business goes unserved.
  * Keep the core of each query to TWO TO FOUR WORDS naming the capability
    ("reservoir simulation software", "payment fraud scoring", "core banking API").
    Stacking five or six qualifiers onto a query makes it match nothing at all —
    outside software especially, over-specific queries return zero results.
  * Prefer the plain capability name over marketing phrasing, and do not pile on years,
    "next-generation", "end-to-end" or similar filler.

Return strict JSON only — no prose, no fences:
{
  "businessLines": [{"name": string, "description": string}],
  "products": [string],
  "customerSegments": [string],
  "whatTheySell": string,
  "namedCompetitors": [string],
  "noClearCompetitors": boolean,
  "noCompetitorsReason": string,
  "techStack": [string],
  "digitalInitiatives": [string],
  "focusAreas": [{"area": string, "why": string}],
  "searchQueries": [string]
}

techStack: technologies, vendors or platforms the company is stated to already use — used later to avoid offering them what they already run. Leave empty rather than guessing.`;

function userPrompt(input: ProfileResearchInput): string {
  const parts: string[] = [
    `Company: ${input.companyName}`,
    input.website ? `Website: ${input.website}` : "",
    ``,
  ].filter(Boolean);

  if (input.pages.length > 0) {
    const perPage = Math.max(1500, Math.floor(MAX_PROFILE_TEXT / input.pages.length));
    parts.push(
      "Website content:",
      ...input.pages.map((p) => `--- ${p.title ?? p.url} (${p.url}) ---\n${p.text.slice(0, perPage)}`)
    );
  }
  if (input.news.length > 0) {
    parts.push(
      ``,
      "Recent coverage:",
      ...input.news.slice(0, 20).map((n) => `- ${n.title}: ${(n.snippet ?? "").slice(0, 300)}`)
    );
  }
  return parts.join("\n");
}

function stringList(v: unknown, cap = 40): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean)
    ),
  ].slice(0, cap);
}

/** Pure and defensive: the model omitting or mistyping arrays must not crash a run. */
export function parseProfileResponse(text: string): TechRadarProfile | null {
  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return null;

  const businessLines = (Array.isArray(parsed.businessLines) ? parsed.businessLines : [])
    .map((b) => {
      const o = b as Record<string, unknown>;
      return { name: String(o?.name ?? "").trim(), description: String(o?.description ?? "").trim() };
    })
    .filter((b) => b.name);

  const focusAreas = (Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [])
    .map((f) => {
      const o = f as Record<string, unknown>;
      return { area: String(o?.area ?? "").trim(), why: String(o?.why ?? "").trim() };
    })
    .filter((f) => f.area);

  return {
    businessLines,
    products: stringList(parsed.products),
    customerSegments: stringList(parsed.customerSegments),
    whatTheySell: String(parsed.whatTheySell ?? "").trim(),
    namedCompetitors: stringList(parsed.namedCompetitors),
    noClearCompetitors: parsed.noClearCompetitors === true,
    noCompetitorsReason: String(parsed.noCompetitorsReason ?? "").trim(),
    techStack: stringList(parsed.techStack),
    digitalInitiatives: stringList(parsed.digitalInitiatives),
    focusAreas,
    searchQueries: stringList(parsed.searchQueries, MAX_QUERIES_PER_COMPANY),
    sources: [],
  };
}

/**
 * Which required research fields are missing, by the 2026-08-26 rules: whatTheySell and
 * customerSegments always required (every company has an answer; empty = failed
 * research). namedCompetitors may be empty only behind an explicit, reasoned
 * noClearCompetitors finding — a declaration without its reason is a checkbox, not a
 * finding, and does not count.
 */
export function missingResearchFields(p: {
  whatTheySell: string;
  customerSegments: string[];
  namedCompetitors: string[];
  noClearCompetitors: boolean;
  noCompetitorsReason: string;
}): string[] {
  const missing: string[] = [];
  if (!p.whatTheySell.trim()) missing.push("whatTheySell");
  if (p.customerSegments.length === 0) missing.push("customerSegments");
  if (p.namedCompetitors.length === 0) {
    if (!p.noClearCompetitors) missing.push("namedCompetitors");
    else if (!p.noCompetitorsReason.trim()) missing.push("noCompetitorsReason");
  }
  return missing;
}

export async function researchProfile(input: ProfileResearchInput): Promise<TechRadarProfile> {
  if (input.pages.length === 0 && input.news.length === 0) {
    throw new Error("tech-radar research: no sources could be read for this company");
  }

  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.profile,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(input) },
      ],
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 40_000 }
  );
  if (!res.ok) throw new Error(`tech-radar research failed: HTTP ${res.status}`);

  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  const profile = parseProfileResponse(text);
  if (!profile) throw new Error("tech-radar research returned unparseable output");

  // Sources record what was ACTUALLY read, never what the model echoed back —
  // the UI uses this to show how thin a profile is.
  profile.sources = [
    ...input.pages.map((p) => ({ url: p.url, title: p.title ?? p.url })),
    ...input.news.slice(0, 10).map((n) => ({ url: n.url, title: n.title })),
  ];

  if (!isUsableProfile(profile)) {
    throw new Error("tech-radar research produced no focus areas or search queries — refusing to activate");
  }

  // Research without the commercial picture is not done: every axis built on top of it
  // regresses to the CTO lens, which is the 2026-08-26 systematic failure. Fails loudly
  // with the field names so the screen says what is missing, not just "failed".
  const missing = missingResearchFields(profile);
  if (missing.length > 0) {
    throw new Error(`tech-radar research incomplete — missing: ${missing.join(", ")}`);
  }
  return profile;
}
