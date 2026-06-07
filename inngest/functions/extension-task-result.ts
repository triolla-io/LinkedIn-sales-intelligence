import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { maybeCompleteEnrollment } from "@/lib/sequences/gating";
import { persistCandidates } from "@/lib/prospecting/candidates";
import { queueNextConnect, releaseConnectSlot, SEARCH_FAIL_CAP } from "@/lib/prospecting/connect-scheduler";
import type { ScrapedCard } from "@/lib/prospecting/filter";
import { buildSearchUrl } from "@/lib/prospecting/search-url";

const REPLY_CHECK_OFFSETS_HOURS = [24, 72, 168];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extensionTaskResultHandler({ event }: any) {
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
  } else if (task.kind === "SEARCH" && task.status === "DONE") {
    await handleSearchResult(task);
  } else if (task.kind === "SEARCH" && task.status === "FAILED") {
    await handleSearchFailure(task);
  } else if (task.kind === "CONNECT") {
    if (task.status === "DONE") await handleConnectSuccess(task);
    else if (task.status === "FAILED") await handleConnectFailure(task);
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
      await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    }
  } else if (task.sequenceExecutionId) {
    const execution = await prisma.sequenceStepExecution.findUnique({
      where: { id: task.sequenceExecutionId },
      include: {
        step: true,
        enrollment: {
          select: {
            id: true,
            contact: { select: { id: true } },
          },
        },
      },
    });
    if (execution) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: execution.enrollment.contact.id,
          templateId: execution.step.templateId,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.sequenceStepExecution.update({
        where: { id: execution.id },
        data: { status: "SENT", sentMessageId: sent.id },
      });

      await maybeCompleteEnrollment(execution.enrollmentId);
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
    await maybeCompleteEnrollment(task.sequenceExecutionId);
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

async function handleSearchResult(task: TaskRow) {
  if (!task.prospectingRunId) return;
  const result = (task.result ?? {}) as { candidates?: ScrapedCard[]; hasNextPage?: boolean };

  await persistCandidates(task.userId, task.prospectingRunId, result.candidates ?? []);

  const run = await prisma.prospectingRun.findUnique({ where: { id: task.prospectingRunId } });
  if (!run || run.status !== "RUNNING") return;

  // A successful page resets the consecutive-failure counter.
  if (run.searchFailCount > 0) {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { searchFailCount: 0 } });
  }

  if (result.hasNextPage) {
    // Advance the page cursor monotonically off the DB value (NOT the task payload), guarded so only
    // one concurrent handler advances and creates the next SEARCH task.
    const nextPage = run.nextSearchPage + 1;
    const searchUrl = buildSearchUrl(run.keywords, nextPage);
    const advanced = await prisma.prospectingRun.updateMany({
      where: { id: run.id, nextSearchPage: run.nextSearchPage },
      data: { nextSearchPage: nextPage, searchUrl },
    });
    if (advanced.count === 1) {
      await prisma.extensionTask.create({
        data: {
          userId: task.userId,
          kind: "SEARCH",
          payload: { searchUrl, page: nextPage },
          prospectingRunId: run.id,
          scheduledFor: new Date(),
        },
      });
    }
  } else {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { discoveryDone: true } });
  }

  // Kickstart sending as soon as candidates land (atomic; chains one at a time thereafter).
  await queueNextConnect(run.id);
}

async function handleSearchFailure(task: TaskRow) {
  if (task.errorCode === "checkpoint") {
    await freezeUserTasks(task.userId, 24);
    if (task.prospectingRunId) {
      await prisma.prospectingRun.update({
        where: { id: task.prospectingRunId },
        data: { pausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
    }
    await prisma.extensionAlert.create({
      data: {
        userId: task.userId,
        kind: "CHECKPOINT",
        message: "LinkedIn flagged your account during search — paused for 24h.",
      },
    });
    return;
  }
  if (!task.prospectingRunId) return;
  // Count the failure; give up discovery after too many so the run can still finish.
  const run = await prisma.prospectingRun.update({
    where: { id: task.prospectingRunId },
    data: { searchFailCount: { increment: 1 } },
  });
  if (run.searchFailCount >= SEARCH_FAIL_CAP && !run.discoveryDone) {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { discoveryDone: true } });
    await queueNextConnect(run.id);
  }
  // Otherwise prospecting-tick re-queues the same page.
}

async function handleConnectSuccess(task: TaskRow) {
  if (!task.connectionRequestId || !task.prospectingRunId) return;
  // Idempotent: only transition + count if not already SENT (guards at-least-once redelivery).
  const updated = await prisma.connectionRequest.updateMany({
    where: { id: task.connectionRequestId, status: { not: "SENT" } },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (updated.count === 1) {
    await prisma.prospectingRun.update({
      where: { id: task.prospectingRunId },
      data: { totalSent: { increment: 1 } },
    });
  }
  await releaseConnectSlot(task.prospectingRunId);
  await maybeCompleteOrContinue(task.prospectingRunId);
}

async function handleConnectFailure(task: TaskRow) {
  if (task.errorCode === "checkpoint") {
    await freezeUserTasks(task.userId, 24);
    if (task.prospectingRunId) {
      await prisma.prospectingRun.update({
        where: { id: task.prospectingRunId },
        data: { pausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
    }
    await prisma.extensionAlert.create({
      data: {
        userId: task.userId,
        kind: "CHECKPOINT",
        message: "LinkedIn flagged your account while sending a connection request — paused for 24h.",
      },
    });
  }
  if (task.connectionRequestId) {
    await prisma.connectionRequest.updateMany({
      where: { id: task.connectionRequestId, status: { notIn: ["SENT", "FAILED"] } },
      data: { status: "FAILED", errorCode: task.errorCode, errorMessage: task.errorMessage },
    });
  }
  if (task.prospectingRunId) {
    await releaseConnectSlot(task.prospectingRunId);
    // Do not chain forward during a checkpoint backoff; queueNextConnect respects pausedUntil anyway.
    if (task.errorCode !== "checkpoint") await maybeCompleteOrContinue(task.prospectingRunId);
  }
}

async function maybeCompleteOrContinue(runId: string) {
  const queued = await queueNextConnect(runId);
  if (queued) return;

  const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "RUNNING" || !run.discoveryDone) return;

  const [remaining, liveConnect] = await Promise.all([
    prisma.connectionRequest.count({ where: { runId, status: { in: ["DISCOVERED", "QUEUED"] } } }),
    prisma.extensionTask.findFirst({
      where: { prospectingRunId: runId, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
      select: { id: true },
    }),
  ]);
  if (remaining === 0 && !liveConnect) {
    await prisma.prospectingRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}

export const extensionTaskResult = inngest.createFunction(
  { id: "extension-task-result", triggers: [{ event: "extension.task.completed" as const }] },
  extensionTaskResultHandler
);
