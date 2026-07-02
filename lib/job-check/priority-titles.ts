export const PRIORITY_TITLE_TERMS = [
  "VP Product",
  "Product Director",
  "Head of Product",
  "Head of Design",
] as const;

export function isPriorityTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return PRIORITY_TITLE_TERMS.some((term) => t.includes(term.toLowerCase()));
}

export function priorityTitleWhere(): {
  OR: Array<{ currentTitle: { contains: string; mode: "insensitive" } }>;
} {
  return {
    OR: PRIORITY_TITLE_TERMS.map((term) => ({
      currentTitle: { contains: term, mode: "insensitive" as const },
    })),
  };
}
