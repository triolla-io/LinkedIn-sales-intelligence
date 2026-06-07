import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildEnrollmentExecutions } from "@/lib/sequences/helpers";

export const sequenceTick = inngest.createFunction(
  { id: "sequence-tick", triggers: [{ cron: "*/5 * * * *" }] },
  async () => {
    const now = new Date();

    const activeSequences = await prisma.sequence.findMany({
      where: { status: "ACTIVE" },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });

    for (const sequence of activeSequences) {
      // 1. Enroll new list members (only if a list is linked)
      if (sequence.contactListId) {
        const existingEnrollments = await prisma.sequenceEnrollment.findMany({
          where: { sequenceId: sequence.id },
          select: { contactId: true },
        });
        const enrolledIds = new Set(existingEnrollments.map((e) => e.contactId));

        const allMembers = await prisma.contactListMember.findMany({
          where: { listId: sequence.contactListId },
          select: { contactId: true },
        });

        const newMembers = allMembers.filter((m) => !enrolledIds.has(m.contactId));
        if (newMembers.length > 0 && sequence.steps.length > 0) {
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
            data: newEnrollments.flatMap((enr) =>
              buildEnrollmentExecutions(enr.enrolledAt, sequence.steps).map((row) => ({
                ...row,
                enrollmentId: enr.id,
              }))
            ),
            skipDuplicates: true,
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

      // 3. Recover executions stuck in SENDING for more than 10 minutes
      const stuckThreshold = new Date(now.getTime() - 10 * 60 * 1000);
      await prisma.sequenceStepExecution.updateMany({
        where: {
          status: "SENDING",
          updatedAt: { lt: stuckThreshold },
          enrollment: { sequenceId: sequence.id, status: "ACTIVE" },
        },
        data: { status: "PENDING", errorMessage: "recovered_from_stuck_sending" },
      });
    }
  }
);
