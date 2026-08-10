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

export function isCLevelTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  // Strip the deputy form first so 'סמנכ"ל כספים' can't match via its 'מנכ"ל' substring.
  const t = title.toLowerCase().replace(new RegExp(HEBREW_DEPUTY_PREFIX, "g"), "");
  return CLEVEL_TITLE_TERMS.some((term) => t.includes(term.toLowerCase()));
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
