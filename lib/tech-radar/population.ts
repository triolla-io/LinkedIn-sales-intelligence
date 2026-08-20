/**
 * Stage 00 — population. Turns "the owner's contact list" into "the cohort, and
 * the employers we need profiles for".
 *
 * This module touches prisma and therefore must NEVER be imported by a client
 * component. The pure half lives in lib/tech-radar/cohort.ts; keep it that way.
 */
import { prisma } from "@/lib/prisma";
import { displayCompanySize } from "@/lib/contacts/display";
import {
  judgeCohort,
  tallyCohort,
  type CohortContact,
  type CohortCounts,
} from "@/lib/tech-radar/cohort";

/** Exactly the columns judgeCohort needs, plus employer resolution. */
export const COHORT_SELECT = {
  id: true,
  ownerId: true,
  radarInclude: true,
  currentTitle: true,
  currentCompany: true,
  companyId: true,
  companySize: true,
  enrichedAt: true,
  lastSyncedAt: true,
  company: { select: { staffCount: true, industry: true } },
} as const;

export type CohortRow = CohortContact & {
  ownerId: string;
  currentCompany: string | null;
  companyId: string | null;
};

export type EmployerRef = {
  companyId: string | null;
  name: string;
  /**
   * Headcount snapshot. Persisted on TrackedCompany so a cohort decision can be
   * explained months later, when the live figure has moved and nobody can say
   * why this company was ever in range.
   */
  staffCount: number | null;
};

/** Grouping key only — never the string we store. */
function normalizeEmployer(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Distinct employers of the contacts that are IN the cohort. Pure, so the
 * dedup rules are testable without a database.
 *
 * A resolved `companyId` wins when any contact at the employer has one: it is
 * exact, and it lets recipient lookup skip name matching entirely later.
 */
export function employersOf(rows: CohortRow[]): EmployerRef[] {
  const byKey = new Map<string, EmployerRef>();

  for (const row of rows) {
    if (!judgeCohort(row).included) continue;
    const raw = (row.currentCompany ?? "").trim();
    if (!raw) continue;
    const key = normalizeEmployer(raw);
    if (!key) continue;

    const existing = byKey.get(key);
    if (existing) {
      // Keep the first spelling, but upgrade to a resolved id if one shows up.
      if (!existing.companyId && row.companyId) existing.companyId = row.companyId;
      if (existing.staffCount === null) existing.staffCount = displayCompanySize(row).value;
    } else {
      byKey.set(key, {
        companyId: row.companyId ?? null,
        name: raw,
        staffCount: displayCompanySize(row).value,
      });
    }
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}

export async function loadCohortRows(ownerId: string): Promise<CohortRow[]> {
  const rows = await prisma.contact.findMany({
    where: { ownerId, removedAt: null },
    select: COHORT_SELECT,
  });
  // Prisma returns Date objects; the pure predicate is written against ISO
  // strings so it can be reused verbatim on the client.
  return rows.map((r) => ({
    ...r,
    enrichedAt: r.enrichedAt ? r.enrichedAt.toISOString() : null,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
  }));
}

export async function summarizeCohort(
  ownerId: string
): Promise<{ counts: CohortCounts; employers: EmployerRef[] }> {
  const rows = await loadCohortRows(ownerId);
  return { counts: tallyCohort(rows), employers: employersOf(rows) };
}
