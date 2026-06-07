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
