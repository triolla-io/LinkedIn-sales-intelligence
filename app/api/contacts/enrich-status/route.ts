import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  contactIds: z.array(z.string()).max(500),
  since: z.string(),
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const { contactIds, since } = schema.parse(await req.json());
  const sinceDate = new Date(since);
  const owned = { id: { in: contactIds }, ownerId: ctx.effectiveUserId };
  const processedWhere = { ...owned, enrichmentRanAt: { gte: sinceDate } };

  const [total, processed, withEmail, withPhone] = await Promise.all([
    prisma.contact.count({ where: owned }),
    prisma.contact.count({ where: processedWhere }),
    prisma.contact.count({ where: { ...processedWhere, email: { not: null } } }),
    prisma.contact.count({ where: { ...processedWhere, phone: { not: null } } }),
  ]);

  return NextResponse.json({ total, processed, withEmail, withPhone });
});
