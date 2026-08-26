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
import { competitorGazetteer } from "@/lib/tech-radar/rationale-rules";

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

// ─── The competitive-set gate: WHOSE axis may a person join? ─────────────────

/**
 * One employer, as far as the merge gate is concerned.
 *
 * Everything here comes off the employer's TrackedCompany row and its research profile,
 * so the caller does the database half and this file stays testable without one.
 */
export type CompetitiveSet = {
  /** TrackedCompany id. Two people at ONE employer are always free to share an axis. */
  employerId: string;
  /** The employer's own name and aliases — needed to see whether a rival names it back. */
  names: string[];
  /** Raw namedCompetitors from research: one entry per company, all its spellings. */
  namedCompetitors: string[];
};

/**
 * How many DISTINCT researched competitors two employers must share before an axis may
 * be shared between them. Two, not one, and the pilot's own numbers are why:
 *
 *   Bank Leumi   → הפועלים, דיסקונט, מזרחי-טפחות, הבינלאומי, וואן זירו
 *   Bank Hapoalim→ לאומי, דיסקונט, מזרחי-טפחות, וואן זירו        ∩ Leumi = 3
 *   The Phoenix  → הראל, מגדל, מנורה, כלל, Lemonade, בנק הפועלים ∩ Leumi = 1
 *
 * Phoenix genuinely competes with Bank Hapoalim on pension and savings, so its list
 * really does contain a bank — which is exactly why a single shared name cannot be the
 * test. At a threshold of one, Elinor Levinson Gafni (Bank Leumi) would still be folded
 * into "תחרות דיגיטלית מול הראל ומגדל" and would still search
 * "ביטוח הראל אפליקציה דיגיטלית חדשה" with one of her two axes, which is the 2026-08-26
 * failure this gate exists to stop. Two separates the sectors and keeps every real peer
 * pair (bank↔bank, insurer↔insurer) merging.
 */
export const MIN_SHARED_COMPETITORS = 2;

/**
 * Shortest alias allowed to match by containment.
 *
 * "בנק" and "bank" are categories, not names: at three characters, containment would
 * make every Israeli bank a competitor of every other by string alone — the "Delek
 * Group" / "Delek US Holdings" mistake in a new costume. Four keeps "לאומי" inside
 * "בנק לאומי" (the case that has to work) and drops the category words.
 */
const MIN_ALIAS_CHARS = 4;

/**
 * The accepted spellings of each researched competitor, ONE GROUP PER COMPANY.
 *
 * competitorGazetteer is reused for the normalisation — the rationale gate and this gate
 * must agree on what a name looks like — but it is applied per ENTRY rather than to the
 * whole list, because flattening loses which spellings belong to which company:
 * "Israel Discount Bank / בנק דיסקונט / דיסקונט" is one shared rival, and counting it as
 * three would clear a threshold of two on its own.
 */
function competitorGroups(namedCompetitors: string[]): string[][] {
  return (namedCompetitors ?? [])
    .map((entry) => competitorGazetteer([entry]))
    .filter((group) => group.length > 0);
}

/** Two spelling groups that name the same company. */
function sameCompany(a: string[], b: string[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      if (x.length >= MIN_ALIAS_CHARS && y.length >= MIN_ALIAS_CHARS && (x.includes(y) || y.includes(x))) {
        return true;
      }
    }
  }
  return false;
}

function namesTheOther(groups: string[][], otherNames: string[]): boolean {
  const other = competitorGazetteer(otherNames);
  return other.length > 0 && groups.some((g) => sameCompany(g, other));
}

/**
 * Do these two employers compete for the same customers?
 *
 * Two roads to yes, and both are deliberately head-to-head:
 *   - MUTUAL naming. Leumi's research names Hapoalim and Hapoalim's names Leumi. A
 *     ONE-directional mention is not enough: Phoenix names Bank Hapoalim while a bank's
 *     list is other banks, and treating that asymmetry as a shared set is how insurance
 *     queries reached a bank VP.
 *   - MIN_SHARED_COMPETITORS distinct rivals in common.
 */
export function sharesCompetitiveSet(a: CompetitiveSet, b: CompetitiveSet): boolean {
  if (a.employerId === b.employerId) return true;

  const ga = competitorGroups(a.namedCompetitors);
  const gb = competitorGroups(b.namedCompetitors);
  if (ga.length === 0 || gb.length === 0) return false;

  if (namesTheOther(ga, b.names) && namesTheOther(gb, a.names)) return true;

  let shared = 0;
  for (const g of ga) {
    if (gb.some((h) => sameCompany(g, h))) shared += 1;
    if (shared >= MIN_SHARED_COMPETITORS) return true;
  }
  return false;
}

export type CompetitiveMergeVerdict =
  | { allowed: true }
  | { allowed: false; reason: "no_shared_competitive_set"; blockedBy: string };

/**
 * May this person's proposal be folded into an axis whose current subscribers work at
 * `owners`?
 *
 * ALL of them must share the incoming employer's competitive set, not any of them:
 * "any" lets a bank join an insurer's axis through a third subscriber that happens to
 * bridge both, and the axis then describes nobody's competitive set. "All" keeps the
 * invariant that every pair of subscribers on one axis competes for the same customers.
 *
 * An axis with no subscribers left (its people were detached by a forced rebuild) is
 * allowed: it carries nobody's competitive set into anyone's model, and refusing it
 * would mint a duplicate axis on every rebuild — walking the org toward the 60-axis
 * ceiling that already cost three people their agenda axis on 2026-08-23.
 */
export function judgeCompetitiveSetMerge(
  incoming: CompetitiveSet,
  owners: CompetitiveSet[]
): CompetitiveMergeVerdict {
  for (const owner of owners) {
    if (!sharesCompetitiveSet(incoming, owner)) {
      return {
        allowed: false,
        reason: "no_shared_competitive_set",
        blockedBy: owner.names[0] ?? owner.employerId,
      };
    }
  }
  return { allowed: true };
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

/** Any Hebrew letter. Used to check that an Israeli person's axes can reach local press. */
export function hasHebrew(text: string): boolean {
  return typeof text === "string" && /[\u0590-\u05FF]/.test(text);
}

/**
 * An Israeli person with no Hebrew query cannot reach Globes, Calcalist or TheMarker —
 * and local news is the most forwardable material there is. The prompt requires one;
 * this checks the database, because a constraint enforced only in a prompt is a
 * constraint that silently stops holding.
 *
 * The 2026-08-23 pattern, twice over: an invariant asserted at one stage and quietly
 * undone downstream.
 */
export function countHebrewQueries(axes: { searchQueries: string[] }[]): number {
  return axes.reduce((n, a) => n + (a.searchQueries ?? []).filter(hasHebrew).length, 0);
}
