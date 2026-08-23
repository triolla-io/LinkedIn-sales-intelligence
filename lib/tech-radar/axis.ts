/**
 * The interest axis: the matching unit that makes relevance a property of a PERSON
 * rather than of their employer.
 *
 * v1 judged fit as `judgeFit(companyProfile, item)`, so the rationale was a property of
 * the company. One AWS item produced three drafts to three founders of 365Scores with a
 * byte-identical reason, because the reason literally could not tell a CEO from a COO.
 * An axis is subscribed to by people, weighted per person, so "why him" has somewhere
 * to come from.
 *
 * Fit is judged once per (axis, item) and shared by every subscriber, which is what
 * keeps LLM cost flat as the person count grows — the reason this shape was chosen over
 * per-person fit.
 *
 * This module is PURE: no prisma, no LLM. Everything here is the cheap half of the
 * merge gate, and it must stay callable from a test without a database.
 */

/** Words that carry no distinguishing meaning in an axis label. */
const FILLER = new Set([
  // Hebrew
  "תחום", "עולם", "שוק", "נושא", "בתחום", "של", "עם", "על",
  // English
  "industry", "sector", "market", "space", "world", "the", "of", "in", "and", "for",
]);

/**
 * Canonical form of an axis label.
 *
 * Token-SORTED on purpose: "זיהוי הונאות" and "הונאות זיהוי" are the same interest, and
 * two people proposing them must land on one axis rather than two. An exact key hit is
 * therefore a free merge — level 1 of the gate.
 */
export function normalizeAxisKey(label: string): string {
  if (typeof label !== "string") return "";
  const tokens = label
    .toLowerCase()
    .replace(/["'`״׳]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FILLER.has(t));
  // Every token was filler — an axis with no distinguishing content is not an axis.
  if (tokens.length === 0) return "";
  return [...new Set(tokens)].sort().join(" ");
}

/**
 * Token overlap between two axis keys. Level 2 of the gate.
 *
 * Jaccard, not substring: v1 matched company names with `contains` and paired "Delek
 * Group" with "Delek US Holdings" — two different companies. Set overlap cannot make
 * that mistake in either direction.
 */
export function axisSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeAxisKey(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeAxisKey(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Auto-merge at or above this. Below AUTO_MERGE but at or above ASK, an LLM decides. */
export const AUTO_MERGE_AT = 0.6;

/**
 * Everything not decided for free is ASKED. Was 0.35, which was wrong twice over.
 *
 * The first live build produced 33 axes for 6 people, each with one subscriber, and
 * merged nothing. Three people at one company got three axes for one subject:
 *   "עיכוב בהעברת נתונים חי וגודל תפוקה"   \
 *   "עיכוב בהעברת נתונים חיים בספורט"      | one subject, three axes
 *   "עיבוד נתונים בזמן אמת בקנה מידה ענק"  /
 * Their pairwise scores were 0.375, 0.083 and 0.091 — so a band starting at 0.35 saw
 * only one of the three pairs, and the pilot shortcut of treating "ask" as "create"
 * meant even that one was not asked.
 *
 * Lexical distance cannot decide this. Two labels for one subject routinely share
 * almost no exact tokens, and Hebrew inflection is invisible to token matching without
 * a lexicon — an attempt to strip it turned "ליבה בנקאית" into "יבה נקאי", which would
 * merge unrelated subjects, the expensive direction of the error.
 *
 * So the model decides, in ONE batched call per profile build. The free levels still
 * short-circuit: an exact key, or overlap at or above AUTO_MERGE_AT, costs nothing.
 */
export const ASK_ABOVE = 0;

export type AxisRow = { id: string; key: string; label: string };

export type MergeVerdict =
  /** Level 1: the same canonical key. Free. */
  | { decision: "merge"; axisId: string; via: "exact_key"; similarity: 1 }
  /** Level 2: token overlap high enough to decide without asking. */
  | { decision: "merge"; axisId: string; via: "similarity"; similarity: number }
  /** Level 3: the ambiguous band. The ONLY case that costs an LLM call. */
  | { decision: "ask"; axisId: string; similarity: number }
  | { decision: "create"; similarity: number }
  /** A label that normalises to nothing cannot become an axis. */
  | { decision: "reject"; reason: "empty_key" };

/**
 * Cheap before expensive, in three levels, exactly so the expensive level runs on the
 * narrow band where it is actually needed.
 *
 * `existing` should be the org's ACTIVE axes only. A MERGED axis is not a merge target —
 * pointing a new subscriber at one would build a chain that no rationale can explain.
 */
export function judgeAxisMerge(label: string, existing: AxisRow[]): MergeVerdict {
  const key = normalizeAxisKey(label);
  if (!key) return { decision: "reject", reason: "empty_key" };

  for (const row of existing) {
    if (row.key === key) return { decision: "merge", axisId: row.id, via: "exact_key", similarity: 1 };
  }

  let best: { row: AxisRow; similarity: number } | null = null;
  for (const row of existing) {
    const similarity = axisSimilarity(label, row.label);
    if (!best || similarity > best.similarity) best = { row, similarity };
  }
  if (!best || best.similarity < ASK_ABOVE) return { decision: "create", similarity: best?.similarity ?? 0 };
  if (best.similarity >= AUTO_MERGE_AT) {
    return { decision: "merge", axisId: best.row.id, via: "similarity", similarity: best.similarity };
  }
  return { decision: "ask", axisId: best.row.id, similarity: best.similarity };
}

export const MAX_AXES_PER_ORG = 60;
export const MAX_AXES_PER_PERSON = 5;

/**
 * An axis whose subscribers exceed this share of the org's people is TOO_BROAD by
 * measurement, not by judgement. "פינטק" with 90% of the cohort subscribed dies on its
 * first scan without anyone having to have an opinion about it.
 */
export const TOO_BROAD_SUBSCRIBER_SHARE = 0.4;

/** Median shareworthy below which an axis is returning noise, however many subscribe. */
export const TOO_BROAD_SHAREWORTHY_FLOOR = 0.45;

export function isTooBroad(input: {
  subscriberCount: number;
  orgPeopleCount: number;
  medianShareworthy: number | null;
}): boolean {
  // Before the first scan there is no median, and subscriber share alone can still
  // condemn an axis — but a brand-new axis with one subscriber must not trip either.
  if (input.orgPeopleCount > 0 && input.subscriberCount / input.orgPeopleCount > TOO_BROAD_SUBSCRIBER_SHARE) {
    return true;
  }
  return input.medianShareworthy != null && input.medianShareworthy < TOO_BROAD_SHAREWORTHY_FLOOR;
}

export type CeilingVerdict =
  | { allowed: true }
  | { allowed: false; reason: "org_ceiling" | "person_ceiling" };

/**
 * Both ceilings, checked before an axis is created.
 *
 * At a ceiling the caller attaches the person to the nearest existing axis instead of
 * creating one — never silently drops them. That fallback is the caller's job; this
 * function only says which ceiling was hit, so the caller can record which.
 */
export function judgeCeilings(input: { orgAxisCount: number; personAxisCount: number }): CeilingVerdict {
  if (input.personAxisCount >= MAX_AXES_PER_PERSON) return { allowed: false, reason: "person_ceiling" };
  if (input.orgAxisCount >= MAX_AXES_PER_ORG) return { allowed: false, reason: "org_ceiling" };
  return { allowed: true };
}

/** COMPANY_MONITOR axes are never shared and never merged, so their key is structural. */
export function companyMonitorKey(trackedCompanyId: string): string {
  return `company:${trackedCompanyId}`;
}
