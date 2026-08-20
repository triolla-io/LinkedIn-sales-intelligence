/**
 * Who the radar operates on.
 *
 * Pure — no prisma, no LLM, no I/O — so it is safe to import from a client
 * component (see the header of lib/tech-radar/types.ts for why that matters).
 *
 * Every contact gets a VERDICT WITH A REASON. That is the whole point: a
 * connections run once reported "0 נמצאו" after silently title-filtering 25
 * people, and the fix is structural — exclusions are counted and named, so the
 * screen can say what happened instead of showing a zero.
 */
import { isCLevelTitle } from "@/lib/company-signals/clevel";
import { displayCompanySize, type ContactForDisplay } from "@/lib/contacts/display";

/** Inclusive band. A 50-person and a 200-person company both qualify. */
export const MIN_STAFF = 50;
export const MAX_STAFF = 200;

export type CohortContact = ContactForDisplay & {
  id: string;
  /** null = follow the cohort rule; true = always in; false = always out. */
  radarInclude: boolean | null;
  currentTitle: string | null;
};

export type CohortReason =
  | "opt_in"             // manually flagged in, cohort rule bypassed
  | "cohort"             // C-level at a 50-200 person company
  | "opt_out"            // manually flagged out
  | "not_clevel"         // title is not top-rank
  | "size_unknown"       // C-level, but we have no headcount — NOT a rejection
  | "size_out_of_range"; // C-level, headcount known, outside the band

export type CohortVerdict = { included: boolean; reason: CohortReason };

/**
 * Order is load-bearing. Seniority is checked BEFORE size so that
 * `size_unknown` only ever counts C-levels — "42 contacts awaiting a company
 * size" has to mean 42 people we would otherwise want, or the number is noise.
 */
export function judgeCohort(c: CohortContact): CohortVerdict {
  if (c.radarInclude === false) return { included: false, reason: "opt_out" };
  // An opt-in is a deliberate human decision and outranks every rule below,
  // including the size gate — that is what makes cultivating a handful of
  // people at a 90,000-person giant possible.
  if (c.radarInclude === true) return { included: true, reason: "opt_in" };

  if (!isCLevelTitle(c.currentTitle)) return { included: false, reason: "not_clevel" };

  const size = displayCompanySize(c).value;
  if (size === null) return { included: false, reason: "size_unknown" };
  if (size < MIN_STAFF || size > MAX_STAFF) {
    return { included: false, reason: "size_out_of_range" };
  }
  return { included: true, reason: "cohort" };
}

export type CohortCounts = Record<CohortReason, number> & { total: number };

const ZERO: CohortCounts = {
  total: 0,
  opt_in: 0,
  cohort: 0,
  opt_out: 0,
  not_clevel: 0,
  size_unknown: 0,
  size_out_of_range: 0,
};

/** Every contact lands in exactly one bucket; the buckets sum to `total`. */
export function tallyCohort(contacts: CohortContact[]): CohortCounts {
  const counts: CohortCounts = { ...ZERO };
  for (const c of contacts) {
    counts.total += 1;
    counts[judgeCohort(c).reason] += 1;
  }
  return counts;
}
