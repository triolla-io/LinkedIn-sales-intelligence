import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { executeSequenceSend } from "@/lib/sequences/execute-send";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";

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
        step: true,
        enrollment: {
          include: {
            contact: true,
            sequence: {
              include: {
                owner: { select: { timezone: true } },
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

      const linkedinUrl = execution.enrollment.contact.linkedinUrl;
      if (!linkedinUrl) {
        await prisma.sequenceStepExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", errorMessage: "missing_linkedin_url" },
        });
        return;
      }

      const text = execution.renderedBody ?? "";
      const { sentTodayCount, sentLastHourCount, lastSentAt } = await getSendStats(
        execution.enrollment.sequence.ownerId
      );

      const tz = execution.enrollment.sequence.owner?.timezone ?? "Asia/Jerusalem";
      const windowStart = execution.step.sendHour;
      const windowEnd = execution.step.sendHourEnd ?? execution.step.sendHour + 1;

      const scheduledFor = computeNextScheduledFor({
        timezone: tz,
        workingHoursStart: windowStart,
        workingHoursEnd: windowEnd,
        weekdaysOnly: false,
        lastSentAt,
        sentTodayCount,
        sentLastHourCount,
        dailyCap: 30,
        hourlyCap: 8,
      });

      await prisma.extensionTask.create({
        data: {
          userId: execution.enrollment.sequence.ownerId,
          kind: "SEND",
          payload: { linkedinUrl, text, recipientName: execution.enrollment.contact.fullName ?? "" },
          sequenceExecutionId: execution.id,
          scheduledFor,
        },
      });

      await prisma.sequenceStepExecution.update({
        where: { id: execution.id },
        data: { status: "QUEUED" },
      });

      return;
    }

    // Delegate EMAIL / WHATSAPP to existing handler
    const result = await executeSequenceSend(executionId);

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
