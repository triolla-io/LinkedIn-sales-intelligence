/**
 * Senior-title detection, two tiers. Substring, case-insensitive; English + Hebrew variants.
 *
 * CLEVEL_TITLE_TERMS — top ranks only (chiefs, founders, owners, מנכ"ל). Used by company
 * signals to gate which companies are monitored and who gets a congratulation draft
 * (user decision 2026-08-10: VPs / heads-of get too many drafts — top ranks only).
 *
 * SENIOR_TITLE_TERMS — the top ranks plus VP / head-of level. Used by fintech-radar,
 * whose topic map explicitly targets VP-level roles (vp-engineering, head-of-payments…).
 *
 * Hebrew gotcha: 'סמנכ"ל' (VP-equivalent) CONTAINS 'מנכ"ל', so the top-tier matcher must
 * explicitly exclude the deputy form or every VP-equivalent sneaks back in.
 */
export const CLEVEL_TITLE_TERMS = [
  // English chief titles
  "chief executive", "chief technolog", "chief technical", "chief financial",
  "chief operating", "chief marketing", "chief product", "chief revenue",
  "chief people", "chief information", "chief security", "chief data",
  "ceo", "cto", "cfo", "coo", "cmo", "cpo", "cro", "chro", "ciso", "cio",
  "founder", "co-founder", "cofounder", "owner",
  "managing director",
  // Hebrew
  'מנכ"ל', "מייסד", "בעלים", "משנה למנכ",
] as const;

export const SENIOR_TITLE_TERMS = [
  ...CLEVEL_TITLE_TERMS,
  "vp ", "vice president", "head of", "svp", "evp",
  'סמנכ"ל',
] as const;

const HEBREW_CEO = 'מנכ"ל';
const HEBREW_DEPUTY_PREFIX = "סמנכ";

/**
 * Bare acronyms have to match as WHOLE WORDS. Matched as substrings, "coo" hit every
 * "Coordinator" and "cro" hit "Microbiologist" — a Human Resources Coordinator was
 * drafted a message before this was caught. Multi-word phrases and the Hebrew terms are
 * distinctive enough to stay substring matches (and \b does not behave usefully around
 * the quote in מנכ"ל).
 */
function matchesTerm(haystack: string, term: string): boolean {
  const t = term.toLowerCase();
  if (!/^[a-z][a-z ]*$/.test(t)) return haystack.includes(t);
  // Trailing space in a term (e.g. "vp ") already forces a boundary on the right.
  const trimmed = t.trim();
  const pattern = new RegExp(`(^|[^a-z])${trimmed}($|[^a-z])`, "i");
  return pattern.test(haystack);
}

function matchesAny(title: string, terms: readonly string[]): boolean {
  // Strip the deputy form first so 'סמנכ"ל כספים' can't match via its 'מנכ"ל' substring.
  const t = title.toLowerCase();
  return terms.some((term) => matchesTerm(t, term));
}

export function isCLevelTitle(title: string | null | undefined): boolean {
  if (!title || !title.trim()) return false;
  const t = title.toLowerCase().replace(new RegExp(HEBREW_DEPUTY_PREFIX, "g"), "");
  return matchesAny(t, CLEVEL_TITLE_TERMS);
}

/**
 * The wider tier: everything C-level plus VP / head-of / deputy-CEO. Use this AFTER the
 * SQL prefilter — `contains` cannot express a word boundary, so the query is coarse on
 * purpose and this is what makes the decision.
 */
export function isSeniorTitle(title: string | null | undefined): boolean {
  if (!title || !title.trim()) return false;
  return matchesAny(title, SENIOR_TITLE_TERMS);
}

type ContainsClause = { currentTitle: { contains: string; mode: "insensitive" } };
export type TitleCondition =
  | ContainsClause
  | { AND: [ContainsClause, { NOT: ContainsClause }] };

function contains(term: string): ContainsClause {
  return { currentTitle: { contains: term, mode: "insensitive" as const } };
}

export function clevelTitleWhere(): { OR: TitleCondition[] } {
  return {
    OR: CLEVEL_TITLE_TERMS.map((term): TitleCondition =>
      term === HEBREW_CEO
        ? { AND: [contains(term), { NOT: contains(HEBREW_DEPUTY_PREFIX) }] }
        : contains(term)
    ),
  };
}

export function seniorTitleWhere(): { OR: ContainsClause[] } {
  // No deputy exclusion needed: סמנכ"ל is explicitly part of this tier.
  return { OR: SENIOR_TITLE_TERMS.map(contains) };
}
