import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { executeSequenceSend } from "@/lib/sequences/execute-send";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";
import { priorStepGate, maybeCompleteEnrollment } from "@/lib/sequences/gating";
import { renderTemplate } from "@/lib/campaigns/render-template";

const RETRY_DELAY_MS = 60_000;

async function getSendStats(userId: string) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [today, lastHour, last] = await Promise.all([
    prisma.sentMessage.count({ where: { senderId: userId, sentAt: { gte: dayAgo } } }),
    prisma.sentMessage.count({ where: { senderId: userId, sentAt: { gte: hourAgo } } }),
    prisma.sentMessage.findFirst({ where: { senderId: userId }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  return { sentTodayCount: today, sentLastHourCount: lastHour, lastSentAt: last?.sentAt ?? null };
}

export const sequenceSendExecution = inngest.createFunction(
  { id: "sequence-send-execution", triggers: [{ event: "sequence.send-execution" as const }] },
  async ({ event }) => {
    const { executionId } = event.data as { executionId: string };

    // Fetch the execution to check channel before delegating
    const execution = await prisma.sequenceStepExecution.findUnique({
      where: { id: executionId },
      include: {
        step: { include: { template: true } },
        enrollment: {
          include: {
            contact: true,
            sequence: {
              include: {
                steps: { orderBy: { stepNumber: "asc" }, select: { id: true } },
                owner: { include: { org: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!execution) throw new Error(`Execution ${executionId} not found`);

    // Handle LinkedIn channel via ExtensionTask
    if (execution.step.channel === "LINKEDIN") {
      if (execution.status !== "PENDING") return;
      if (execution.enrollment.sequence.status !== "ACTIVE") return;
      if (execution.enrollment.status !== "ACTIVE") return;

      const gate = await priorStepGate(
        execution.enrollmentId,
        execution.stepId,
        execution.enrollment.sequence.steps
      );
      if (gate === "defer") return; // stays PENDING; next tick retries
      if (gate === "skip") {
        await prisma.sequenceStepExecution.update({
          where: { id: execution.id },
          data: { status: "SKIPPED", errorMessage: "prior_step_failed" },
        });
        await maybeCompleteEnrollment(execution.enrollmentId);
        return;
      }

      const linkedinUrl = execution.enrollment.contact.linkedinUrl;
      if (!linkedinUrl) {
        await prisma.sequenceStepExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", errorMessage: "missing_linkedin_url" },
        });
        await maybeCompleteEnrollment(execution.enrollmentId);
        return;
      }

      const { contact, sequence } = execution.enrollment;
      const owner = sequence.owner;
      const sender = {
        firstName: owner.name?.trim().split(/\s+/)[0] ?? null,
        lastName: owner.name?.trim().split(/\s+/).slice(1).join(" ") || null,
        company: owner.org?.name ?? null,
        title: owner.title ?? null,
      };
      const recipient = {
        firstName: contact.fullName?.trim().split(/\s+/)[0] ?? null,
        lastName: contact.fullName?.trim().split(/\s+/).slice(1).join(" ") || null,
        company: contact.currentCompany,
        title: contact.currentTitle,
        hebrewFirstName: contact.hebrewFirstName ?? null,
      };
      const { body: text } = renderTemplate(execution.step.template.body, { sender, recipient });

      const { sentTodayCount, sentLastHourCount, lastSentAt } = await getSendStats(sequence.ownerId);

      const tz = owner.timezone ?? "Asia/Jerusalem";
      const windowStart = execution.step.sendHour;
      const windowEnd = execution.step.sendHourEnd ?? execution.step.sendHour + 1;

      const scheduledFor = computeNextScheduledFor({
        timezone: tz,
        workingHoursStart: 0,  // window already enforced by scheduledAt; here we only need rate-limit jitter
        workingHoursEnd: 24,
        weekdaysOnly: false,
        lastSentAt,
        sentTodayCount,
        sentLastHourCount,
        dailyCap: 30,
        hourlyCap: 8,
      });

      await prisma.extensionTask.create({
        data: {
          userId: sequence.ownerId,
          kind: "SEND",
          payload: { linkedinUrl, text, recipientName: contact.fullName ?? "" },
          sequenceExecutionId: execution.id,
          scheduledFor,
        },
      });

      await prisma.sequenceStepExecution.update({
        where: { id: execution.id },
        data: { status: "QUEUED", renderedBody: text },
      });

      return;
    }

    // Delegate EMAIL / WHATSAPP to existing handler
    const result = await executeSequenceSend(executionId);

    if (result.outcome === "deferred" || result.outcome === "skipped_prior_failed") return;

    if (result.outcome === "rate_limited") {
      await inngest.send({
        name: "sequence.send-execution" as const,
        data: { executionId },
        ts: Date.now() + result.retryAfterSec * 1000,
      });
      return;
    }

    if (result.outcome === "failed" && result.willRetry) {
      await inngest.send({
        name: "sequence.send-execution" as const,
        data: { executionId },
        ts: Date.now() + RETRY_DELAY_MS,
      });
    }
  }
);
