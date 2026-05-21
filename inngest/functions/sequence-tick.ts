import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const sequenceTick = inngest.createFunction(
  { id: "sequence-tick", triggers: [{ cron: "0 * * * *" }] }, // top of every hour
  async () => {
    const now = new Date();

    const activeSequences = await prisma.sequence.findMany({
      where: { status: "ACTIVE" },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });

    for (const sequence of activeSequences) {
      // 1. Enroll new list members
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
      for (const member of allMembers) {
        if (enrolledIds.has(member.contactId)) continue;
        const enrollment = await prisma.sequenceEnrollment.create({
          data: { sequenceId: sequence.id, contactId: member.contactId, status: "ACTIVE" },
        });
        if (firstStep) {
          await prisma.sequenceStepExecution.create({
            data: {
              enrollmentId: enrollment.id,
              stepId: firstStep.id,
              status: "PENDING",
              scheduledAt: computeScheduledAt(enrollment.enrolledAt, firstStep.dayOffset),
            },
          });
        }
      }

      // 2. Dispatch due PENDING executions
      const dueExecutions = await prisma.sequenceStepExecution.findMany({
        where: {
          status: "PENDING",
          scheduledAt: { lte: now },
          enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
        },
        select: { id: true },
      });

      for (const exec of dueExecutions) {
        await inngest.send({
          name: "sequence.send-execution" as const,
          data: { executionId: exec.id },
        });
      }
    }
  }
);
