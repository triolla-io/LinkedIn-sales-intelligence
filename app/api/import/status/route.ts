import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const userId = ctx.effectiveUserId;

  const [pendingEnrichment, pendingCompanies] = await Promise.all([
    // Contacts that haven't been through Haiku yet (no seniority or no hebrewFirstName check)
    prisma.contact.count({
      where: {
        ownerId: userId,
        removedAt: null,
        enrichmentRanAt: null,
        seniority: null,
      },
    }),
    // Companies linked to this user's contacts that still lack staffCount and haven't been attempted
    prisma.company.count({
      where: {
        staffCount: null,
        lastEnrichedAt: null,
        contacts: { some: { ownerId: userId, removedAt: null } },
      },
    }),
  ]);

  return NextResponse.json({ pendingEnrichment, pendingCompanies });
});
