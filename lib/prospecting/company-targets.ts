import { prisma } from "@/lib/prisma";
import type { ParsedCompany } from "@/lib/prospecting/company-sheet";

export type InsertTargetsResult = {
  added: number;
  skippedExisting: number;
  skippedInvalid: number;
};

/**
 * Insert companies as PENDING targets. Dedup is enforced by the DB unique(runId, dedupKey):
 * existing rows (and in-batch duplicates) are skipped. Companies the user previously REMOVED
 * are revived to PENDING so re-uploading a sheet restores them.
 */
export async function insertCompanyTargets(
  runId: string,
  companies: ParsedCompany[],
  skippedInvalid = 0,
): Promise<InsertTargetsResult> {
  if (companies.length === 0)
    return { added: 0, skippedExisting: 0, skippedInvalid };
  const revived = await prisma.prospectingCompanyTarget.updateMany({
    where: {
      runId,
      dedupKey: { in: companies.map((c) => c.dedupKey) },
      status: "REMOVED",
    },
    data: { status: "PENDING", error: null },
  });
  const created = await prisma.prospectingCompanyTarget.createMany({
    data: companies.map((c) => ({
      runId,
      name: c.name,
      nameHebrew: c.nameHebrew,
      linkedinUrl: c.linkedinUrl,
      linkedinSlug: c.linkedinSlug,
      website: c.website,
      vertical: c.vertical,
      dedupKey: c.dedupKey,
    })),
    skipDuplicates: true,
  });
  return {
    added: created.count + revived.count,
    skippedExisting: companies.length - created.count - revived.count,
    skippedInvalid,
  };
}
