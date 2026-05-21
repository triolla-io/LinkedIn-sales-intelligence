import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, templateId, contactIds, listId, filter, channel, subject } = body as {
    name?: string;
    templateId?: string;
    contactIds?: string[];
    listId?: string;
    filter?: unknown;
    channel?: string;
    subject?: string;
  };

  if (!name || !templateId) {
    return NextResponse.json({ error: "name and templateId required" }, { status: 400 });
  }
  if (!contactIds && !listId && filter === undefined) {
    return NextResponse.json({ error: "contactIds, listId, or filter required" }, { status: 400 });
  }

  const resolvedChannel = channel === "EMAIL" ? "EMAIL" : channel === "WHATSAPP" ? "WHATSAPP" : "LINKEDIN";

  const tpl = await prisma.messageTemplate.findFirst({ where: { id: templateId, ownerId: ctx.effectiveUserId } });
  if (!tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  let resolvedContactIds = contactIds;
  if (listId && !resolvedContactIds) {
    const list = await prisma.contactList.findFirst({
      where: { id: listId, ownerId: ctx.effectiveUserId },
    });
    if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });
    const members = await prisma.contactListMember.findMany({
      where: { listId },
      select: { contactId: true },
    });
    resolvedContactIds = members.map((m: { contactId: string }) => m.contactId);
  }

  const filterJson = resolvedContactIds ? { contactIds: resolvedContactIds } : { filter };
  const campaign = await prisma.campaign.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name,
      channel: resolvedChannel,
      templateId,
      status: "DRAFT",
      filterJson: filterJson as never,
      ...(resolvedChannel === "EMAIL" && subject ? { subject } : {}),
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
