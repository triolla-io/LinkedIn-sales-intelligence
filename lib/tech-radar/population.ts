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
  company: { select: { staffCount: true, website: true } },
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
  /**
   * Carried through so research has a page to read. Without it, research falls
   * back to news-only (or throws "no sources" after paying for the search) —
   * same first-wins / upgrade-if-null rule as companyId and staffCount.
   */
  website: string | null;
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

    const rowWebsite = row.company?.website ?? null;
    const existing = byKey.get(key);
    if (existing) {
      // Keep the first spelling, but upgrade to a resolved id if one shows up.
      if (!existing.companyId && row.companyId) existing.companyId = row.companyId;
      if (existing.staffCount === null) existing.staffCount = displayCompanySize(row).value;
      if (!existing.website && rowWebsite) existing.website = rowWebsite;
    } else {
      byKey.set(key, {
        companyId: row.companyId ?? null,
        name: raw,
        staffCount: displayCompanySize(row).value,
        website: rowWebsite,
      });
    }
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}

/**
 * Cohort-included contacts whose employer name is missing or blank. `employersOf`
 * silently drops these rows because there is nothing to key them by — but they
 * are still counted as "in cohort" by `tallyCohort`, so without this they vanish
 * from the screen a second time with no trace. Matters more for the plan that
 * makes an employer mandatory: these people would disappear again, at a stage
 * that costs money.
 */
export function countNoEmployer(rows: CohortRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (!judgeCohort(row).included) continue;
    if (!(row.currentCompany ?? "").trim()) n += 1;
  }
  return n;
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
): Promise<{ counts: CohortCounts; employers: EmployerRef[]; noEmployer: number }> {
  const rows = await loadCohortRows(ownerId);
  return { counts: tallyCohort(rows), employers: employersOf(rows), noEmployer: countNoEmployer(rows) };
}

/**
 * Exact-name-or-alias match against companies already tracked. Deliberately
 * EXACT after normalization, not `contains`: v1 used `contains` and matched
 * "Delek Group" against "Delek US Holdings", which are different companies.
 * A missed match creates a duplicate row — annoying, and fixable by adding an
 * alias. A wrong match attributes one company's news to another.
 */
export function matchExistingCompany(
  employer: EmployerRef,
  existing: { id: string; name: string; aliases: string[] }[]
): string | null {
  const key = normalizeEmployer(employer.name);
  if (!key) return null;
  for (const row of existing) {
    for (const candidate of [row.name, ...row.aliases]) {
      if (normalizeEmployer(candidate ?? "") === key) return row.id;
    }
  }
  return null;
}

/**
 * Bring the employer list into TrackedCompany. No duplicate rows, and no
 * research re-offers for jobs already in flight.
 *
 * Returns both:
 * - New and failed rows needing research dispatch (caller decides whether to dispatch)
 * - Existing rows stuck in PENDING_RESEARCH, for observability
 *
 * Population and spend stay separable — this module reports, the caller acts.
 */
export async function upsertEmployers(
  orgId: string,
  employers: EmployerRef[]
): Promise<{ created: number; matched: number; pendingResearch: string[]; alreadyPending: string[] }> {
  const existing = await prisma.trackedCompany.findMany({
    where: { orgId },
    select: {
      id: true, name: true, aliases: true, status: true,
      staffCount: true, companyId: true, website: true,
    },
  });

  let created = 0;
  let matched = 0;
  const pendingResearch: string[] = [];
  const alreadyPending: string[] = [];

  for (const employer of employers) {
    const hit = matchExistingCompany(employer, existing);
    if (hit) {
      matched += 1;
      const row = existing.find((e) => e.id === hit);
      // Only RESEARCH_FAILED is re-offered. A row still sitting in
      // PENDING_RESEARCH was already dispatched by an earlier run and its job
      // may still be in flight — re-offering it is how a second bootstrap run
      // turns into duplicate research spend.
      if (row && row.status === "RESEARCH_FAILED") pendingResearch.push(hit);
      else if (row && row.status === "PENDING_RESEARCH") alreadyPending.push(hit);

      // Backfill only what is missing. The column is the snapshot behind the
      // size gate and the page research reads — a pre-existing row must not
      // keep a null forever just because it matched by name instead of being
      // created fresh, but a value we already trust is never overwritten.
      if (row) {
        const patch: { staffCount?: number; companyId?: string; website?: string } = {};
        if (row.staffCount === null && employer.staffCount !== null) patch.staffCount = employer.staffCount;
        if (row.companyId === null && employer.companyId !== null) patch.companyId = employer.companyId;
        if (row.website === null && employer.website !== null) patch.website = employer.website;
        if (Object.keys(patch).length > 0) {
          await prisma.trackedCompany.update({ where: { id: row.id }, data: patch });
          Object.assign(row, patch);
        }
      }
      continue;
    }

    const row = await prisma.trackedCompany.create({
      data: {
        orgId,
        name: employer.name,
        companyId: employer.companyId,
        staffCount: employer.staffCount,
        website: employer.website,
        autoAdded: true,
        status: "PENDING_RESEARCH",
      },
      select: {
        id: true, name: true, aliases: true, status: true,
        staffCount: true, companyId: true, website: true,
      },
    });
    existing.push(row);
    created += 1;
    pendingResearch.push(row.id);
  }

  return { created, matched, pendingResearch, alreadyPending };
}
