import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { parseSteps } from "@/lib/sequences/helpers";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const sequences = await prisma.sequence.findMany({
    where: { ownerId: ctx.effectiveUserId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, select: { id: true, stepNumber: true, channel: true, dayOffset: true } },
      contactList: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
  });
  return NextResponse.json({ sequences });
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json();
  const { name, contactListId, steps: rawSteps } = body as {
    name?: string;
    contactListId?: string;
    steps?: unknown;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!contactListId) {
    return NextResponse.json({ error: "contactListId required" }, { status: 400 });
  }

  const list = await prisma.contactList.findFirst({
    where: { id: contactListId, ownerId: ctx.effectiveUserId },
  });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });

  const steps = parseSteps(rawSteps);
  if (!steps) {
    return NextResponse.json(
      { error: "steps must be a non-empty array of valid step objects" },
      { status: 400 }
    );
  }

  // Validate all templateIds belong to this user
  const templateIds = [...new Set(steps.map((s) => s.templateId))];
  const templates = await prisma.messageTemplate.findMany({
    where: { id: { in: templateIds }, ownerId: ctx.effectiveUserId },
    select: { id: true },
  });
  if (templates.length !== templateIds.length) {
    return NextResponse.json({ error: "one or more templates not found" }, { status: 404 });
  }

  const sequence = await prisma.sequence.create({
    data: {
      ownerId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      name: name.trim(),
      contactListId,
      status: "DRAFT",
      steps: {
        create: steps.map((s) => ({
          stepNumber: s.stepNumber,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.subject,
        })),
      },
    },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  return NextResponse.json({ sequence }, { status: 201 });
});
