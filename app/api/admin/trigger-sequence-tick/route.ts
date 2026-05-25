import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";
import { executeSequenceSend } from "@/lib/sequences/execute-send";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  const activeSequences = await prisma.sequence.findMany({
    where: { status: "ACTIVE" },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  for (const sequence of activeSequences) {
    // Enroll new list members
    const existingEnrollments = await prisma.sequenceEnrollment.findMany({
      where: { sequenceId: sequence.id },
      select: { contactId: true },
    });
    const enrolledIds = new Set(existingEnrollments.map((e) => e.contactId));

    const allMembers = await prisma.contactListMember.findMany({
      where: { listId: sequence.contactListId },
      select: { contactId: true },
    });

    const firstStep = sequence.steps[0];
    const newMembers = allMembers.filter((m) => !enrolledIds.has(m.contactId));
    if (newMembers.length > 0 && firstStep) {
      await prisma.sequenceEnrollment.createMany({
        data: newMembers.map((m) => ({
          sequenceId: sequence.id,
          contactId: m.contactId,
          status: "ACTIVE" as const,
        })),
        skipDuplicates: true,
      });

      const newEnrollments = await prisma.sequenceEnrollment.findMany({
        where: {
          sequenceId: sequence.id,
          contactId: { in: newMembers.map((m) => m.contactId) },
        },
        select: { id: true, enrolledAt: true },
      });

      await prisma.sequenceStepExecution.createMany({
        data: newEnrollments.map((enr) => ({
          enrollmentId: enr.id,
          stepId: firstStep.id,
          status: "PENDING" as const,
          scheduledAt: computeScheduledAt(enr.enrolledAt, firstStep.dayOffset, firstStep.sendHour, firstStep.sendMinute),
        })),
        skipDuplicates: true,
      });
    }

    // Execute due sends directly (no Inngest dependency)
    const dueExecutions = await prisma.sequenceStepExecution.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: now },
        enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
      },
      select: { id: true },
    });

    for (const exec of dueExecutions) {
      await executeSequenceSend(exec.id);
    }
  }

  const results = await prisma.sequenceStepExecution.groupBy({
    by: ["status"],
    where: { scheduledAt: { lte: now } },
    _count: true,
  });

  return NextResponse.json({ ok: true, results });
}
