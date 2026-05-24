import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { computeScheduledAt } from "@/lib/sequences/helpers";

export const sequenceStart = inngest.createFunction(
  { id: "sequence-start", triggers: [{ event: "sequence.start" as const }] },
  async ({ event }) => {
    const { sequenceId } = event.data as { sequenceId: string };

    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    if (!sequence) throw new Error(`Sequence ${sequenceId} not found`);
    if (sequence.status !== "QUEUED") return; // idempotency guard

    const now = new Date();
    await prisma.sequence.update({
      where: { id: sequenceId },
      data: { status: "ACTIVE", startedAt: now },
    });

    const firstStep = sequence.steps[0];
    if (!firstStep) return; // no steps configured

    const members = await prisma.contactListMember.findMany({
      where: { listId: sequence.contactListId },
      select: { contactId: true },
    });

    for (const member of members) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { sequenceId, contactId: member.contactId, status: "ACTIVE" },
      });
      const scheduledAt = computeScheduledAt(
        enrollment.enrolledAt,
        firstStep.dayOffset,
        firstStep.sendHour,
        firstStep.sendMinute
      );
      await prisma.sequenceStepExecution.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: firstStep.id,
          status: "PENDING",
          scheduledAt,
        },
      });
    }
  }
);
