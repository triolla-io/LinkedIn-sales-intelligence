export interface DueRow {
  id: string;
  ownerId: string;
  linkedinUrl: string;
  lastJobCheckAt: Date | null;
}

/** Oldest-first (never-checked / null first), capped. */
export function selectDueContacts(rows: DueRow[], cap: number): DueRow[] {
  const sorted = [...rows].sort((a, b) => {
    const at = a.lastJobCheckAt?.getTime() ?? -Infinity;
    const bt = b.lastJobCheckAt?.getTime() ?? -Infinity;
    return at - bt;
  });
  return sorted.slice(0, Math.max(0, cap));
}
