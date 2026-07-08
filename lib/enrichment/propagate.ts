import { prisma } from "@/lib/prisma";
import { normalizeLinkedinUrl } from "@/lib/enrichment/enrich-contact-core";

/** Enrichment fields that can be copied onto sibling contacts. */
export interface PropagatableValues {
  email?: string | null;
  phone?: string | null;
  companySize?: number | null;
  currentCompany?: string | null;
  industry?: string | null;
}

export interface PropagateOpts {
  orgId: string;
  linkedinUrlNormalized: string;
  /** Contact that triggered the enrichment — excluded from the fan-out. */
  sourceContactId?: string;
  values: PropagatableValues;
}

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === "";

/**
 * Fill enrichment fields on every OTHER contact in the org that shares the same
 * normalized LinkedIn profile. Fills only empty fields — never overwrites an
 * existing value (locked or not). Idempotent: safe to run repeatedly.
 */
export async function propagateEnrichment(
  opts: PropagateOpts
): Promise<{ scanned: number; filled: number }> {
  const { orgId, linkedinUrlNormalized, sourceContactId, values } = opts;

  const slug = linkedinUrlNormalized.split("/in/")[1] ?? "";
  if (!slug) return { scanned: 0, filled: 0 };

  const candidates = await prisma.contact.findMany({
    where: {
      owner: { orgId },
      removedAt: null,
      linkedinUrl: { contains: slug, mode: "insensitive" },
      ...(sourceContactId ? { id: { not: sourceContactId } } : {}),
    },
    select: {
      id: true,
      linkedinUrl: true,
      email: true,
      phone: true,
      companySize: true,
      currentCompany: true,
      industry: true,
    },
  });

  let filled = 0;
  for (const c of candidates) {
    // Confirm the substring pre-filter really matched the same profile.
    if (normalizeLinkedinUrl(c.linkedinUrl) !== linkedinUrlNormalized) continue;

    const patch: Record<string, unknown> = {};
    if (isEmpty(c.email) && !isEmpty(values.email)) patch.email = values.email;
    if (isEmpty(c.phone) && !isEmpty(values.phone)) patch.phone = values.phone;
    if (isEmpty(c.companySize) && !isEmpty(values.companySize)) patch.companySize = values.companySize;
    if (isEmpty(c.currentCompany) && !isEmpty(values.currentCompany)) patch.currentCompany = values.currentCompany;
    if (isEmpty(c.industry) && !isEmpty(values.industry)) patch.industry = values.industry;

    if (Object.keys(patch).length === 0) continue;

    const now = new Date();
    patch.enrichedAt = now;
    patch.enrichmentSource = "cache";
    patch.enrichmentRanAt = now;

    await prisma.contact.update({ where: { id: c.id }, data: patch });
    filled++;
  }

  return { scanned: candidates.length, filled };
}
