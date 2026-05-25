import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

/** Returns empty string if the URL has no real profile slug. */
function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!/^\/in\/.+/.test(path)) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

export const POST = withTenant(async (_req, ctx) => {
  const userId = ctx.effectiveUserId;
  const orgId = ctx.org.id;

  // Load contacts that are missing email or phone and have a LinkedIn URL
  // (contacts without a LinkedIn URL cannot be safely cache-matched)
  const contacts = await prisma.contact.findMany({
    where: {
      ownerId: userId,
      removedAt: null,
      linkedinUrl: { not: null },
      OR: [{ email: null }, { phone: null }],
    },
    select: { id: true, linkedinUrl: true, email: true, phone: true, manualFields: true },
  });

  if (contacts.length === 0) return NextResponse.json({ updated: 0 });

  // Batch-lookup PersonEnrichment cache — filter out any empty-string normalized URLs
  const normalizedUrls = contacts
    .map((c) => normalizeLinkedinUrl(c.linkedinUrl!))
    .filter(Boolean);
  const cached = await prisma.personEnrichment.findMany({
    where: { orgId, linkedinUrlNormalized: { in: normalizedUrls } },
    select: { linkedinUrlNormalized: true, email: true, phone: true },
  });
  const cacheMap = new Map(cached.map((c) => [c.linkedinUrlNormalized, c]));

  let updated = 0;
  for (const contact of contacts) {
    const hit = cacheMap.get(normalizeLinkedinUrl(contact.linkedinUrl));
    if (!hit || (!hit.email && !hit.phone)) continue;

    const protected_ = new Set(contact.manualFields as string[]);
    const patch: Record<string, unknown> = {
      enrichmentSource: "cache",
      enrichmentRanAt: new Date(),
      enrichedAt: new Date(),
      enrichmentError: null,
    };
    if (!protected_.has("email") && hit.email && !contact.email) patch.email = hit.email;
    if (!protected_.has("phone") && hit.phone && !contact.phone) patch.phone = hit.phone;

    if (!patch.email && !patch.phone) continue;

    await prisma.contact.update({ where: { id: contact.id }, data: patch });
    updated++;
  }

  return NextResponse.json({ updated });
});
