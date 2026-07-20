/**
 * C-level / senior-leadership title detection. Mirrors lib/job-check/priority-titles.ts.
 * Substring, case-insensitive; covers English + Hebrew variants. Used both to gate which
 * companies we monitor (via clevelTitleWhere) and to pick draft recipients.
 */
export const CLEVEL_TITLE_TERMS = [
  // English chief titles
  "chief executive", "chief technolog", "chief technical", "chief financial",
  "chief operating", "chief marketing", "chief product", "chief revenue",
  "chief people", "chief information", "chief security", "chief data",
  "ceo", "cto", "cfo", "coo", "cmo", "cpo", "cro", "chro", "ciso", "cio",
  "founder", "co-founder", "cofounder", "owner",
  "vp ", "vice president", "head of", "svp", "evp",
  "managing director",
  // Hebrew
  'מנכ"ל', 'סמנכ"ל', "מייסד", "בעלים", "משנה למנכ",
] as const;

export function isCLevelTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return CLEVEL_TITLE_TERMS.some((term) => t.includes(term.toLowerCase()));
}

export function clevelTitleWhere(): {
  OR: Array<{ currentTitle: { contains: string; mode: "insensitive" } }>;
} {
  return {
    OR: CLEVEL_TITLE_TERMS.map((term) => ({
      currentTitle: { contains: term, mode: "insensitive" as const },
    })),
  };
}
