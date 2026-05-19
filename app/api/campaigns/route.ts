import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, templateId, contactIds, filter } = body as {
    name?: string; templateId?: string; contactIds?: string[]; filter?: unknown;
  };
  if (!name || !templateId) {
    return NextResponse.json({ error: "name and templateId required" }, { status: 400 });
  }
  const tpl = await prisma.messageTemplate.findFirst({ where: { id: templateId, ownerId: ctx.effectiveUserId } });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const filterJson = contactIds ? { contactIds } : { filter };
  const campaign = await prisma.campaign.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name,
      channel: "LINKEDIN",
      templateId,
      status: "DRAFT",
      filterJson: filterJson as never,
    },
  });
  return NextResponse.json({ campaign }, { status: 201 });
});

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: ctx.effectiveUserId },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
  });
  return NextResponse.json({ campaigns });
});
