import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { sendEmail } from "@/lib/gmail/client";
import { waClient } from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { computeScheduledAt } from "@/lib/sequences/helpers";

const MAX_ATTEMPTS = 3;

function firstName(full: string | null): string | null {
  if (!full) return null;
  return full.trim().split(/\s+/)[0] ?? null;
}
function lastName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

export type ExecuteSendResult =
  | { outcome: "skipped_not_pending" }
  | { outcome: "skipped_sequence_inactive" }
  | { outcome: "skipped_enrollment_inactive" }
  | { outcome: "rate_limited"; retryAfterSec: number }
  | { outcome: "missing_variables"; variables: string[] }
  | { outcome: "sent" }
  | { outcome: "failed"; error: string; willRetry: boolean };

export async function executeSequenceSend(executionId: string): Promise<ExecuteSendResult> {
  const execution = await prisma.sequenceStepExecution.findUnique({
    where: { id: executionId },
    include: {
      step: { include: { template: true } },
      enrollment: {
        include: {
          contact: true,
          sequence: {
            include: {
              steps: { orderBy: { stepNumber: "asc" } },
              owner: { include: { org: true } },
            },
          },
        },
      },
    },
  });

  if (!execution) throw new Error(`Execution ${executionId} not found`);
  if (execution.status !== "PENDING") return { outcome: "skipped_not_pending" };
  if (execution.enrollment.sequence.status !== "ACTIVE") return { outcome: "skipped_sequence_inactive" };
  if (execution.enrollment.status !== "ACTIVE") return { outcome: "skipped_enrollment_inactive" };

  const { contact, sequence, enrolledAt } = execution.enrollment;
  const step = execution.step;
  const ownerId = sequence.ownerId;

  const prefix = step.channel === "EMAIL" ? "email:send:" : "wa:send:";
  const quota = await checkSendQuota(ownerId, { prefix });
  if (!quota.ok) return { outcome: "rate_limited", retryAfterSec: quota.retryAfterSec };

  const sender = {
    firstName: firstName(sequence.owner.name),
    lastName: lastName(sequence.owner.name),
    company: sequence.owner.org?.name ?? null,
    title: sequence.owner.title ?? null,
  };
  const recipient = {
    firstName: firstName(contact.fullName),
    lastName: lastName(contact.fullName),
    company: contact.currentCompany,
    title: contact.currentTitle,
  };
  const { body, missing } = renderTemplate(step.template.body, { recipient, sender });

  if (missing.length > 0) {
    await prisma.sequenceStepExecution.update({
      where: { id: executionId },
      data: { status: "SKIPPED", errorMessage: `missing_variable:${missing.join(",")}` },
    });
    await maybeAdvance(execution.enrollmentId, step.id, sequence.steps, enrolledAt);
    return { outcome: "missing_variables", variables: missing };
  }

  await prisma.sequenceStepExecution.update({
    where: { id: executionId },
    data: { status: "SENDING", attemptCount: { increment: 1 }, renderedBody: body },
  });

  try {
    if (step.channel === "EMAIL") {
      if (!contact.email) throw new Error("no_email");
      if (!step.subject) throw new Error("no_subject");
      await sendEmail(ownerId, { to: contact.email, subject: step.subject, body });
    } else {
      const rawPhone = contact.phone;
      if (!rawPhone) throw new Error("no_phone");
      const phone = normalizePhone(rawPhone);
      if (!phone) throw new Error("invalid_phone");
      await waClient.send(ownerId, phone, body);
    }

    const sent = await prisma.sentMessage.create({
      data: {
        senderId: ownerId,
        actorId: ownerId,
        contactId: contact.id,
        templateId: step.templateId,
        body,
        status: "SENT",
        sentAt: new Date(),
      },
    });

    await prisma.sequenceStepExecution.update({
      where: { id: executionId },
      data: { status: "SENT", sentAt: new Date(), sentMessageId: sent.id },
    });

    await maybeAdvance(execution.enrollmentId, step.id, sequence.steps, enrolledAt);
    return { outcome: "sent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const attempts = execution.attemptCount + 1;
    const willRetry = attempts < MAX_ATTEMPTS;
    await prisma.sequenceStepExecution.update({
      where: { id: executionId },
      data: { status: willRetry ? "PENDING" : "FAILED", errorMessage: msg },
    });
    if (!willRetry) {
      await maybeAdvance(execution.enrollmentId, step.id, sequence.steps, enrolledAt);
    }
    return { outcome: "failed", error: msg, willRetry };
  }
}

async function maybeAdvance(
  enrollmentId: string,
  currentStepId: string,
  allSteps: Array<{ id: string; stepNumber: number; dayOffset: number; sendHour: number; sendMinute: number }>,
  enrolledAt: Date
) {
  const currentIndex = allSteps.findIndex((s) => s.id === currentStepId);
  const nextStep = allSteps[currentIndex + 1];

  if (nextStep) {
    await prisma.sequenceStepExecution.create({
      data: {
        enrollmentId,
        stepId: nextStep.id,
        status: "PENDING",
        scheduledAt: computeScheduledAt(enrolledAt, nextStep.dayOffset, nextStep.sendHour, nextStep.sendMinute),
      },
    });
  } else {
    const enrollment = await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "COMPLETED" },
      select: { sequenceId: true },
    });

    const activeCount = await prisma.sequenceEnrollment.count({
      where: { sequenceId: enrollment.sequenceId, status: "ACTIVE" },
    });
    if (activeCount === 0) {
      await prisma.sequence.update({
        where: { id: enrollment.sequenceId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}
