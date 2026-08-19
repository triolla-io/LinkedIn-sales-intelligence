/**
 * Stage 4: the per-company fit judgement.
 *
 * Everything before this stage is company-agnostic and shared; this is where the
 * work becomes specific. Two steps, cheap-then-expensive:
 *   1. prefilterItems — pure category overlap against the company profile, plus
 *      dropping anything already in their tech stack. No LLM, no cost.
 *   2. judgeFit — one small LLM call per survivor that writes the rationale.
 *
 * `fitRationale` — not the item summary — is what feeds the outreach message, so
 * the prompt insists on a concrete tie to this company's lines of business.
 *
 * Mirrors the prefilter-then-confirm shape of lib/fintech-radar/match.ts.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose, clampScore } from "@/lib/tech-radar/parse";
import {
  FIT_CANDIDATE_CAP,
  OR_FEATURE,
  type FitVerdict,
  type TechRadarProfile,
} from "@/lib/tech-radar/types";

export type FitItem = {
  itemId: string;
  vendor: string | null;
  technology: string;
  title: string;
  summary: string;
  categories: string[];
};

const CORPORATE_SUFFIXES = /\b(inc|ltd|llc|corp|corporation|plc|gmbh|sa|bv|co)\b/g;
const STOPWORDS = new Set([
  "the", "and", "for", "with", "our", "your", "new", "platform", "solution", "solutions",
  "service", "services", "system", "systems", "company", "group", "technology", "technologies",
  "management", "digital", "data", "based", "using",
]);
/** Below this length a token matches too much to be evidence of anything. */
const MIN_TOKEN = 4;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length >= MIN_TOKEN && !STOPWORDS.has(t));
}

/** Terms that describe what this company actually does. */
export function profileTerms(profile: TechRadarProfile): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => tokens(s).forEach((t) => out.add(t));
  for (const f of profile.focusAreas ?? []) add(f.area ?? "");
  for (const b of profile.businessLines ?? []) add(b.name ?? "");
  for (const p of profile.products ?? []) add(p);
  return out;
}

/**
 * True when the company already runs this technology or vendor. Checked both
 * directions (a stack entry may be broader or narrower than the item's name),
 * but only on tokens long enough to be meaningful — a 2-character stack entry
 * would otherwise match nearly everything.
 */
export function alreadyInStack(profile: TechRadarProfile, item: FitItem): boolean {
  const stack = (profile.techStack ?? []).map(normalize).filter((s) => s.length >= MIN_TOKEN);
  if (stack.length === 0) return false;
  const names = [item.vendor, item.technology]
    .filter((n): n is string => !!n)
    .map(normalize)
    .filter((n) => n.length >= MIN_TOKEN);
  return names.some((n) => stack.some((s) => s.includes(n) || n.includes(s)));
}

/**
 * Rank items by how much their categories overlap what the company does, drop
 * what they already run, and keep the top FIT_CANDIDATE_CAP. Deterministic:
 * ties break on itemId so an Inngest replay produces the same shortlist.
 */
export function prefilterItems(profile: TechRadarProfile, items: FitItem[]): FitItem[] {
  const eligible = items.filter((i) => !alreadyInStack(profile, i));
  const terms = profileTerms(profile);

  // Nothing usable to match on — pass through rather than silently dropping all.
  if (terms.size === 0) return eligible.slice(0, FIT_CANDIDATE_CAP);

  const scored = eligible.map((item) => {
    const itemTokens = new Set([
      ...item.categories.flatMap((c) => tokens(c)),
      ...tokens(item.technology),
    ]);
    let overlap = 0;
    for (const t of itemTokens) {
      if (terms.has(t)) overlap += 1;
      else if ([...terms].some((p) => p.includes(t) || t.includes(p))) overlap += 0.5;
    }
    return { item, overlap };
  });

  return scored
    .sort((a, b) => (b.overlap !== a.overlap ? b.overlap - a.overlap : a.item.itemId < b.item.itemId ? -1 : 1))
    .slice(0, FIT_CANDIDATE_CAP)
    .map((s) => s.item);
}

const SYSTEM = `You judge whether a newly launched technology is genuinely relevant to ONE specific company, based on that company's researched profile.

The company is a potential or existing customer of a sales rep. The rep wants to bring them technology worth knowing about — not to pitch, and not to send them generic industry news.

Be strict. MOST items you see are not a fit, and returning fits=false is the expected outcome — a rep would rather see three real opportunities than fifteen plausible ones.

Return fits=true ONLY when the technology ties to something NAMED in the profile: a named product, a named business line, a named system in their stack, or a named focus area. The tie must be specific enough that the rep could point at it.

Return fits=false when:
- the connection is only that they are in the same industry, or the same broad market
- it would apply equally well to any company of that type
- the technology addresses a problem the profile gives no evidence they have
- you have to reason through two or more steps to make it relevant

Examples of what to reject: a food-traceability regulation offered to an energy group merely because it also owns farmland; an e-signature standard offered to a bank merely because banks sign things.

The rationale is the single most important field: it becomes the body of a short Hebrew message to a senior executive there.
- BAD (rejected): "relevant to fintech", "important for banks", "connects to their digital strategy".
- GOOD: names the company's own product or business line and the specific tie — e.g. "מתחבר לביט ולתשלומים בין-אישיים שאתם מפעילים, כי זה מקצר את זמן הסליקה".
- ONE short sentence, in HEBREW, no emojis.

Also name which of the company's OWN business lines this connects to, copied from the
profile's business lines verbatim. A diversified holding company must not have one line
take every slot, so this attribution matters.

Return strict JSON only — no prose, no fences:
{"fits": boolean, "fitRationale": "one short sentence in Hebrew", "score": 0.0-1.0, "businessLine": "<one of the company's business lines>"}`;

function userPrompt(profile: TechRadarProfile, companyName: string, item: FitItem): string {
  return [
    `Company: ${companyName}`,
    `Business lines: ${(profile.businessLines ?? []).map((b) => `${b.name} — ${b.description}`).join(" | ") || "n/a"}`,
    `Products: ${(profile.products ?? []).join(", ") || "n/a"}`,
    `Customer segments: ${(profile.customerSegments ?? []).join(", ") || "n/a"}`,
    `Known tech stack: ${(profile.techStack ?? []).join(", ") || "n/a"}`,
    `Recent digital initiatives: ${(profile.digitalInitiatives ?? []).join(", ") || "n/a"}`,
    `Focus areas: ${(profile.focusAreas ?? []).map((f) => `${f.area} (${f.why})`).join(" | ") || "n/a"}`,
    ``,
    `New technology: ${item.technology}${item.vendor ? ` by ${item.vendor}` : ""}`,
    `Headline: ${item.title}`,
    `What it is: ${item.summary}`,
    `Tags: ${item.categories.join(", ") || "n/a"}`,
  ].join("\n");
}

export function parseFitResponse(text: string): FitVerdict | null {
  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return null;
  const rationale = String(parsed.fitRationale ?? "").trim();
  const fits = parsed.fits === true;
  // A "fits" verdict with no rationale is unusable — the rationale IS the output.
  if (fits && !rationale) return null;
  const businessLine = String(parsed.businessLine ?? "").trim();
  return {
    fits,
    fitRationale: rationale,
    score: clampScore(parsed.score),
    businessLine: businessLine || null,
  };
}

export async function judgeFit(
  profile: TechRadarProfile,
  companyName: string,
  item: FitItem
): Promise<FitVerdict> {
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.fit,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(profile, companyName, item) },
      ],
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 25_000 }
  );
  if (!res.ok) throw new Error(`tech-radar fit failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  const verdict = parseFitResponse(text);
  if (!verdict) throw new Error("tech-radar fit returned unparseable output");
  return verdict;
}
