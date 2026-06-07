import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { sendEmail } from "@/lib/gmail/client";
import { waClient } from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { computeScheduledAt } from "@/lib/sequences/helpers";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { priorStepGate, maybeCompleteEnrollment } from "@/lib/sequences/gating";

const TIMEZONE = "Asia/Jerusalem";

/** Returns the next Date that falls within [sendHour, sendHourEnd) in Jerusalem time. */
function nextWindowStart(sendHour: number, sendHourEnd: number): Date {
  const now = new Date();
  const local = toZonedTime(now, TIMEZONE);
  const localHour = local.getHours();

  if (localHour >= sendHour && localHour < sendHourEnd) return now; // already inside window

  // Build today's window start in Jerusalem
  const todayStr = local.toISOString().slice(0, 10);
  const todayStart = fromZonedTime(`${todayStr}T${String(sendHour).padStart(2, "0")}:00:00`, TIMEZONE);

  // If today's window hasn't started yet, use it; otherwise tomorrow
  if (todayStart > now) return todayStart;
  const tomorrow = new Date(local);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return fromZonedTime(`${tomorrowStr}T${String(sendHour).padStart(2, "0")}:00:00`, TIMEZONE);
}

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
  | { outcome: "failed"; error: string; willRetry: boolean }
  | { outcome: "skipped_prior_failed" }
  | { outcome: "deferred" };

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
              steps: { orderBy: { stepNumber: "asc" }, select: { id: true, stepNumber: true, dayOffset: true, sendHour: true, sendMinute: true, sendHourEnd: true } },
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

  const orderedSteps = execution.enrollment.sequence.steps;
  const gate = await priorStepGate(execution.enrollmentId, execution.stepId, orderedSteps);
  if (gate === "defer") return { outcome: "deferred" };
  if (gate === "skip") {
    await prisma.sequenceStepExecution.update({
      where: { id: executionId },
      data: { status: "SKIPPED", errorMessage: "prior_step_failed" },
    });
    await maybeCompleteEnrollment(execution.enrollmentId);
    return { outcome: "skipped_prior_failed" };
  }

  const { contact, sequence } = execution.enrollment;
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
    hebrewFirstName: contact.hebrewFirstName ?? null,
  };
  const { body, missing } = renderTemplate(step.template.body, { recipient, sender });

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

    await maybeCompleteEnrollment(execution.enrollmentId);
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
      await maybeCompleteEnrollment(execution.enrollmentId);
    }
    return { outcome: "failed", error: msg, willRetry };
  }
}

export function computeWindowedScheduledAt(
  enrolledAt: Date,
  step: { dayOffset: number; sendHour: number; sendMinute: number; sendHourEnd: number | null },
  now: Date
): Date {
  const base = computeScheduledAt(enrolledAt, step.dayOffset, step.sendHour, step.sendMinute);
  if (!step.sendHourEnd) return base;

  const windowEnd = computeScheduledAt(enrolledAt, step.dayOffset, step.sendHourEnd, 0);
  const lower = Math.max(now.getTime() + 60_000, base.getTime());
  const upper = windowEnd.getTime() - 60_000;

  if (lower >= upper) return new Date(lower); // window tight or passed — send as soon as possible
  return new Date(lower + Math.random() * (upper - lower));
}

