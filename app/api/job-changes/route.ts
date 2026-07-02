import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const rows = await prisma.contactJobChange.findMany({
    where: { contact: { ownerId: ctx.effectiveUserId } },
    orderBy: { detectedAt: "desc" },
    take: 200,
    select: {
      id: true,
      contactId: true,
      prevTitle: true,
      newTitle: true,
      prevCompany: true,
      newCompany: true,
      detectedAt: true,
      contact: { select: { fullName: true, linkedinUrl: true } },
    },
  });

  return NextResponse.json({
    changes: rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      fullName: r.contact.fullName,
      linkedinUrl: r.contact.linkedinUrl,
      prevTitle: r.prevTitle,
      newTitle: r.newTitle,
      prevCompany: r.prevCompany,
      newCompany: r.newCompany,
      detectedAt: r.detectedAt.toISOString(),
    })),
  });
});
