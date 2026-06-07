import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { buildEnrollmentExecutions } from "@/lib/sequences/helpers";

export const sequenceStart = inngest.createFunction(
  { id: "sequence-start", triggers: [{ event: "sequence.start" as const }] },
  async ({ event }) => {
    const { sequenceId } = event.data as { sequenceId: string };

    const sequence = await prisma.sequence.findUnique({
      where: { id: sequenceId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    });
    if (!sequence) throw new Error(`Sequence ${sequenceId} not found`);
    if (sequence.status !== "QUEUED") return;

    const now = new Date();
    await prisma.sequence.update({
      where: { id: sequenceId },
      data: { status: "ACTIVE", startedAt: now },
    });

    if (sequence.steps.length === 0) return;

    // Only auto-enroll from list if one is linked
    if (!sequence.contactListId) return;

    const members = await prisma.contactListMember.findMany({
      where: { listId: sequence.contactListId },
      select: { contactId: true },
    });

    for (const member of members) {
      const enrollment = await prisma.sequenceEnrollment.create({
        data: { sequenceId, contactId: member.contactId, status: "ACTIVE" },
      });
      await prisma.sequenceStepExecution.createMany({
        data: buildEnrollmentExecutions(enrollment.enrolledAt, sequence.steps).map((row) => ({
          ...row,
          enrollmentId: enrollment.id,
        })),
        skipDuplicates: true,
      });
    }
  }
);
