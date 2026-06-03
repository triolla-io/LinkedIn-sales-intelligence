import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { parseSteps } from "@/lib/sequences/helpers";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const body = await _req.json();
    const { name, contactListId, steps: rawSteps } = body as {
      name?: unknown;
      contactListId?: unknown;
      steps?: unknown;
    };

    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });

    const updateData: Record<string, unknown> = {};

    if (typeof name === "string" && name.trim()) {
      updateData.name = name.trim();
    }
    if (contactListId !== undefined) {
      updateData.contactListId = (contactListId as string | null) ?? null;
    }

    await prisma.sequence.update({ where: { id }, data: updateData });

    // Steps can only be replaced on DRAFT sequences
    if (rawSteps !== undefined) {
      if (sequence.status !== "DRAFT") {
        return NextResponse.json(
          { error: "steps can only be changed on DRAFT campaigns" },
          { status: 409 }
        );
      }
      const steps = parseSteps(rawSteps);
      if (!steps) return NextResponse.json({ error: "invalid steps" }, { status: 400 });

      await prisma.sequenceStep.deleteMany({ where: { sequenceId: id } });
      await prisma.sequenceStep.createMany({
        data: steps.map((s) => ({
          sequenceId: id,
          stepNumber: s.stepNumber,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.subject,
          sendHour: s.sendHour,
          sendMinute: s.sendMinute,
          sendHourEnd: s.sendHourEnd ?? null,
        })),
      });
    }

    const updated = await prisma.sequence.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    return NextResponse.json({ sequence: updated });
  })(req);
}
