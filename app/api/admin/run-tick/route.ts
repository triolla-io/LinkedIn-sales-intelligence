import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";
import { executeSequenceSend } from "@/lib/sequences/execute-send";

export async function POST(req: NextRequest) {
  return withTenant(async (_req, ctx) => {
    const now = new Date();
    const log: string[] = [];

    const activeSequences = await prisma.sequence.findMany({
      where: { status: "ACTIVE", ownerId: ctx.effectiveUserId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });

    log.push(`רצפים פעילים: ${activeSequences.length}`);

    for (const sequence of activeSequences) {
      if (sequence.contactListId) {
        const existing = await prisma.sequenceEnrollment.findMany({
          where: { sequenceId: sequence.id },
          select: { contactId: true },
        });
        const enrolledIds = new Set(existing.map((e) => e.contactId));
        const allMembers = await prisma.contactListMember.findMany({
          where: { listId: sequence.contactListId },
          select: { contactId: true },
        });
        const firstStep = sequence.steps[0];
        const newMembers = allMembers.filter((m) => !enrolledIds.has(m.contactId));
        if (newMembers.length > 0 && firstStep) {
          await prisma.sequenceEnrollment.createMany({
            data: newMembers.map((m) => ({ sequenceId: sequence.id, contactId: m.contactId, status: "ACTIVE" as const })),
            skipDuplicates: true,
          });
          const newEnrollments = await prisma.sequenceEnrollment.findMany({
            where: { sequenceId: sequence.id, contactId: { in: newMembers.map((m) => m.contactId) } },
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
          log.push(`${sequence.name}: הרשמנו ${newMembers.length} אנשי קשר חדשים`);
        }
      }

      const due = await prisma.sequenceStepExecution.findMany({
        where: {
          status: "PENDING",
          scheduledAt: { lte: now },
          enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
        },
        select: { id: true },
      });

      log.push(`${sequence.name}: ${due.length} הודעות לשליחה עכשיו`);

      for (const exec of due) {
        const result = await executeSequenceSend(exec.id);
        log.push(`  → ${exec.id.slice(-6)}: ${result.outcome}`);
      }
    }

    return NextResponse.json({ ok: true, log });
  })(req);
}
