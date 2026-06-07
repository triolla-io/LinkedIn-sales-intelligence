import { prisma } from "@/lib/prisma";

export type GateDecision = "proceed" | "skip" | "defer";

/**
 * Decide whether the step `currentStepId` may run, based on the prior step's execution
 * for the same enrollment. `orderedSteps` must be sorted by stepNumber ascending.
 */
export async function priorStepGate(
  enrollmentId: string,
  currentStepId: string,
  orderedSteps: Array<{ id: string }>
): Promise<GateDecision> {
  const idx = orderedSteps.findIndex((s) => s.id === currentStepId);
  if (idx <= 0) return "proceed"; // first step, or step not found in list

  const priorStepId = orderedSteps[idx - 1].id;
  const prior = await prisma.sequenceStepExecution.findUnique({
    where: { enrollmentId_stepId: { enrollmentId, stepId: priorStepId } },
    select: { status: true },
  });

  if (!prior) return "proceed"; // defensive: nothing to block on
  if (prior.status === "SENT") return "proceed";
  if (prior.status === "FAILED" || prior.status === "SKIPPED") return "skip";
  return "defer"; // PENDING / QUEUED / SENDING
}

/** Mark the enrollment COMPLETED once all its executions are terminal; complete the sequence if it was the last active enrollment. */
export async function maybeCompleteEnrollment(enrollmentId: string): Promise<void> {
  const remaining = await prisma.sequenceStepExecution.count({
    where: { enrollmentId, status: { notIn: ["SENT", "FAILED", "SKIPPED"] } },
  });
  if (remaining > 0) return;

  const updated = await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollmentId, status: "ACTIVE" },
    data: { status: "COMPLETED" },
  });
  if (updated.count === 0) return; // already completed/removed — avoid double work

  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { sequenceId: true },
  });
  if (!enrollment) return;

  const active = await prisma.sequenceEnrollment.count({
    where: { sequenceId: enrollment.sequenceId, status: "ACTIVE" },
  });
  if (active === 0) {
    await prisma.sequence.update({
      where: { id: enrollment.sequenceId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}
