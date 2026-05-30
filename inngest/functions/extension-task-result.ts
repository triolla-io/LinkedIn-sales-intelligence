import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

const REPLY_CHECK_OFFSETS_HOURS = [24, 72, 168];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function extensionTaskResultHandler({ event }: any) {
  const { taskId } = event.data as { taskId: string };
  const task = await prisma.extensionTask.findUnique({ where: { id: taskId } });
  if (!task) return;

  if (task.kind === "SEND") {
    if (task.status === "DONE") {
      await handleSendSuccess(task);
    } else if (task.status === "FAILED") {
      await handleSendFailure(task);
    }
  } else if (task.kind === "CHECK_REPLY" && task.status === "DONE") {
    await handleReplyCheck(task);
  }
}

type TaskRow = Awaited<ReturnType<typeof prisma.extensionTask.findUniqueOrThrow>>;

async function handleSendSuccess(task: TaskRow) {
  const result = (task.result ?? {}) as { sentAt?: string; conversationUrl?: string };
  const payload = (task.payload ?? {}) as { text?: string };

  if (task.recipientId) {
    const recipient = await prisma.campaignRecipient.findUnique({
      where: { id: task.recipientId },
      include: { campaign: true },
    });
    if (recipient) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: recipient.contactId,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SENT", sentMessageId: sent.id, sentAt: sent.sentAt },
      });
      await scheduleReplyChecks(task, result.conversationUrl, sent.sentAt.toISOString());
      await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    }
  } else if (task.sequenceExecutionId) {
    const execution = await prisma.sequenceStepExecution.findUnique({
      where: { id: task.sequenceExecutionId },
      include: { enrollment: { include: { contact: true } } },
    });
    if (execution) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: execution.enrollment.contact.id,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.sequenceStepExecution.update({
        where: { id: execution.id },
        data: { status: "SENT", sentMessageId: sent.id },
      });
      await scheduleReplyChecks(task, result.conversationUrl, sent.sentAt.toISOString());
    }
  }
}

async function scheduleReplyChecks(task: TaskRow, conversationUrl: string | undefined, sinceIso: string) {
  for (const h of REPLY_CHECK_OFFSETS_HOURS) {
    await prisma.extensionTask.create({
      data: {
        userId: task.userId,
        kind: "CHECK_REPLY",
        payload: { conversationUrl: conversationUrl ?? null, sinceIso } as Prisma.InputJsonValue,
        recipientId: task.recipientId,
        sequenceExecutionId: task.sequenceExecutionId,
        scheduledFor: new Date(Date.now() + h * 60 * 60 * 1000),
      },
    });
  }
}

async function handleSendFailure(task: TaskRow) {
  if (task.errorCode === "checkpoint") {
    await freezeUserTasks(task.userId, 24);
    await prisma.extensionAlert.create({
      data: {
        userId: task.userId,
        kind: "CHECKPOINT",
        message: "LinkedIn flagged your account — review at linkedin.com/checkpoint. Sends paused for 24h.",
      },
    });
  }
  if (task.recipientId) {
    await prisma.campaignRecipient.update({
      where: { id: task.recipientId },
      data: { status: "FAILED", errorMessage: task.errorMessage ?? task.errorCode ?? "extension_failed" },
    });
  } else if (task.sequenceExecutionId) {
    await prisma.sequenceStepExecution.update({
      where: { id: task.sequenceExecutionId },
      data: { status: "FAILED", errorMessage: task.errorMessage ?? task.errorCode ?? "extension_failed" },
    });
  }
}

async function freezeUserTasks(userId: string, hours: number) {
  await prisma.extensionTask.updateMany({
    where: { userId, status: "PENDING" },
    data: { scheduledFor: new Date(Date.now() + hours * 60 * 60 * 1000) },
  });
}

async function handleReplyCheck(task: TaskRow) {
  const result = (task.result ?? {}) as { replyDetected?: boolean; replies?: Array<{ text: string; at: string }> };
  if (!result.replyDetected) return;

  if (task.recipientId) {
    const recipient = await prisma.campaignRecipient.findUnique({ where: { id: task.recipientId } });
    if (recipient) {
      for (const r of result.replies ?? []) {
        await prisma.sentMessage.create({
          data: {
            senderId: task.userId,
            actorId: task.userId,
            contactId: recipient.contactId,
            body: r.text,
            status: "SENT",
            sentAt: new Date(r.at),
          },
        });
      }
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "REPLIED" } });
      await prisma.extensionTask.updateMany({
        where: { recipientId: recipient.id, kind: "CHECK_REPLY", status: "PENDING" },
        data: { status: "DONE", completedAt: new Date() },
      });
    }
  }
}

export const extensionTaskResult = inngest.createFunction(
  { id: "extension-task-result", triggers: [{ event: "extension.task.completed" as const }] },
  extensionTaskResultHandler
);
