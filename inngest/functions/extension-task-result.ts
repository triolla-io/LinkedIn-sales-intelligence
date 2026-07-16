import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { maybeCompleteEnrollment } from "@/lib/sequences/gating";
import { persistCandidates } from "@/lib/prospecting/candidates";
import { queueNextConnect, releaseConnectSlot, SEARCH_FAIL_CAP } from "@/lib/prospecting/connect-scheduler";
import type { ScrapedCard } from "@/lib/prospecting/filter";
import { buildSearchUrl } from "@/lib/prospecting/search-url";
import { logProspectingEvent } from "@/lib/prospecting/events";
import {
  buildCompanySearchUrl,
  failCompanyTarget,
  interCompanyDelayMs,
  maybeCompleteCompanyRun,
  startNextPendingTarget,
} from "@/lib/prospecting/company-discovery";

const REPLY_CHECK_OFFSETS_HOURS = [24, 72, 168];

/** A prospecting run re-runs discovery this long after exhausting its current pool (recurring routine). */
const REDISCOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  } else if (task.kind === "SEARCH" && task.status === "DONE") {
    await handleSearchResult(task);
  } else if (task.kind === "SEARCH" && task.status === "FAILED") {
    await handleSearchFailure(task);
  } else if (task.kind === "RESOLVE_COMPANY" && task.status === "DONE") {
    await handleResolveCompanyResult(task);
  } else if (task.kind === "RESOLVE_COMPANY" && task.status === "FAILED") {
    await handleResolveCompanyFailure(task);
  } else if (task.kind === "CONNECT") {
    if (task.status === "DONE") await handleConnectSuccess(task);
    else if (task.status === "FAILED") await handleConnectFailure(task);
  }
}

type TaskRow = Awaited<ReturnType<typeof prisma.extensionTask.findUniqueOrThrow>>;

async function handleSendSuccess(task: TaskRow) {
  const result = (task.result ?? {}) as { sentAt?: string; conversationUrl?: string };
  const payload = (task.payload ?? {}) as { text?: string };

  if (task.jobChangeId) {
    const change = await prisma.contactJobChange.findUnique({
      where: { id: task.jobChangeId },
      select: { id: true, contactId: true },
    });
    if (change) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: change.contactId,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.contactJobChange.update({
        where: { id: change.id },
        data: { status: "SENT", sentAt: sent.sentAt },
      });
    }
    return;
  }

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
  if (task.jobChangeId) {
    // Return to the review queue so the user can simply re-approve; the failed
    // task's error is surfaced on the row by the job-changes GET endpoint.
    await prisma.contactJobChange.updateMany({
      where: { id: task.jobChangeId, status: "APPROVED" },
      data: { status: "PENDING_REVIEW" },
    });
    return;
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
    const failedExec = await prisma.sequenceStepExecution.findUnique({
      where: { id: task.sequenceExecutionId },
      select: { enrollmentId: true },
    });
    if (failedExec) await maybeCompleteEnrollment(failedExec.enrollmentId);
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

async function handleResolveCompanyResult(task: TaskRow) {
  if (!task.prospectingRunId) return;
  const { targetId } = (task.payload ?? {}) as { targetId?: string };
  if (!targetId) return;
  const result = (task.result ?? {}) as {
    companyId?: string;
    resolvedName?: string;
    slug?: string;
    matchedUrl?: string;
  };

  const [run, target] = await Promise.all([
    prisma.prospectingRun.findUnique({ where: { id: task.prospectingRunId } }),
    prisma.prospectingCompanyTarget.findUnique({ where: { id: targetId } }),
  ]);
  if (!run || !target) return;
  if (target.status === "REMOVED") {
    if (run.status === "RUNNING")
      await startNextPendingTarget(run.id, interCompanyDelayMs());
    return;
  }

  if (!result.companyId) {
    await failCompanyTarget(run.id, target, "no_id");
    return;
  }

  await prisma.prospectingCompanyTarget.update({
    where: { id: target.id },
    data: {
      linkedinCompanyId: result.companyId,
      resolvedName: result.resolvedName ?? null,
      linkedinSlug: target.linkedinSlug ?? result.slug ?? null,
      status: "READY",
      error: null,
    },
  });

  if (run.status !== "RUNNING") return;
  await prisma.extensionTask.create({
    data: {
      userId: task.userId,
      kind: "SEARCH",
      payload: {
        searchUrl: buildCompanySearchUrl(
          run,
          result.companyId,
          target.searchPage,
        ),
        page: target.searchPage,
        targetId: target.id,
      },
      prospectingRunId: run.id,
      scheduledFor: new Date(),
    },
  });
  await prisma.prospectingCompanyTarget.update({
    where: { id: target.id },
    data: { status: "SEARCHING" },
  });
}

async function handleResolveCompanyFailure(task: TaskRow) {
  if (!task.prospectingRunId) return;
  const { targetId } = (task.payload ?? {}) as { targetId?: string };
  if (!targetId) return;
  const [run, target] = await Promise.all([
    prisma.prospectingRun.findUnique({ where: { id: task.prospectingRunId } }),
    prisma.prospectingCompanyTarget.findUnique({ where: { id: targetId } }),
  ]);
  if (!run || !target) return;

  if (task.errorCode === "checkpoint") {
    await freezeUserTasks(task.userId, 24);
    await prisma.prospectingRun.update({
      where: { id: run.id },
      data: { pausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    await prisma.extensionAlert.create({
      data: {
        userId: task.userId,
        kind: "CHECKPOINT",
        message:
          "LinkedIn flagged your account during company resolve — paused for 24h.",
      },
    });
    // Put the company back in line; prospecting-tick re-queues after the freeze.
    await prisma.prospectingCompanyTarget.updateMany({
      where: { id: target.id, status: "RESOLVING" },
      data: { status: "PENDING" },
    });
    return;
  }

  // Old extension that doesn't know RESOLVE_COMPANY: defer 1h without failing the
  // target, and surface an "update your extension" hint on the routine page.
  const isUnsupportedKind =
    task.errorCode === "unsupported_kind" ||
    (task.errorCode === "bad_payload" && task.errorMessage === "unknown_kind");
  if (isUnsupportedKind) {
    await prisma.extensionTask.create({
      data: {
        userId: task.userId,
        kind: "RESOLVE_COMPANY",
        payload: task.payload as Prisma.InputJsonValue,
        prospectingRunId: run.id,
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await logProspectingEvent({
      runId: run.id,
      type: "FAILED",
      message: "extension_outdated",
    });
    return;
  }

  if (target.status === "REMOVED") {
    if (run.status === "RUNNING")
      await startNextPendingTarget(run.id, interCompanyDelayMs());
    return;
  }
  await failCompanyTarget(run.id, target, task.errorCode ?? "resolve_failed");
}

async function handleSearchResult(task: TaskRow) {
  if (!task.prospectingRunId) return;
  const result = (task.result ?? {}) as { candidates?: ScrapedCard[]; hasNextPage?: boolean };
  const payload = (task.payload ?? {}) as { targetId?: string };

  const run = await prisma.prospectingRun.findUnique({ where: { id: task.prospectingRunId } });
  if (run?.targetType === "COMPANY" && payload.targetId) {
    await handleCompanySearchResult(task, run, payload.targetId, result);
    return;
  }

  await persistCandidates(task.userId, task.prospectingRunId, result.candidates ?? []);

  if (!run || run.status !== "RUNNING") return;

  // A successful page resets the consecutive-failure counter.
  if (run.searchFailCount > 0) {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { searchFailCount: 0 } });
  }

  if (result.hasNextPage) {
    // Connections module master switch: if the owner has turned it off, do NOT create the next
    // SEARCH task — discovery is paused. Run status is never mutated by the toggle.
    // Resume path: when the module is re-enabled, prospecting-tick re-queues discovery from
    // nextSearchPage because there will be no live SEARCH task for this run.
    const ownerFlags = await prisma.user.findUnique({
      where: { id: run.ownerId },
      select: { routineConnectionsEnabled: true },
    });
    if (!ownerFlags || ownerFlags.routineConnectionsEnabled) {
      // Advance the page cursor monotonically off the DB value (NOT the task payload), guarded so only
      // one concurrent handler advances and creates the next SEARCH task.
      const nextPage = run.nextSearchPage + 1;
      const searchUrl = buildSearchUrl(
        { keywords: run.keywords, geoUrn: run.geoUrn, industryIds: run.industryIds },
        nextPage
      );
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
    }
  } else {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { discoveryDone: true } });
  }

  // Kickstart sending as soon as candidates land (atomic; chains one at a time thereafter).
  await queueNextConnect(run.id);
}

async function handleCompanySearchResult(
  task: TaskRow,
  run: NonNullable<
    Awaited<ReturnType<typeof prisma.prospectingRun.findUnique>>
  >,
  targetId: string,
  result: { candidates?: ScrapedCard[]; hasNextPage?: boolean },
) {
  const target = await prisma.prospectingCompanyTarget.findUnique({
    where: { id: targetId },
  });
  if (!target || target.status === "REMOVED") {
    // Company was removed mid-search — drop the page and keep the loop moving.
    if (run.status === "RUNNING")
      await startNextPendingTarget(run.id, interCompanyDelayMs());
    return;
  }

  await persistCandidates(
    task.userId,
    run.id,
    result.candidates ?? [],
    target.id,
  );

  if (run.status !== "RUNNING") return;
  if (run.searchFailCount > 0) {
    await prisma.prospectingRun.update({
      where: { id: run.id },
      data: { searchFailCount: 0 },
    });
  }

  if (result.hasNextPage) {
    // Same module master-switch gate as keyword runs.
    const ownerFlags = await prisma.user.findUnique({
      where: { id: run.ownerId },
      select: { routineConnectionsEnabled: true },
    });
    if (!ownerFlags || ownerFlags.routineConnectionsEnabled) {
      // Pagination lives on the TARGET (not run.nextSearchPage); guarded so only one handler advances.
      const nextPage = target.searchPage + 1;
      const advanced = await prisma.prospectingCompanyTarget.updateMany({
        where: { id: target.id, searchPage: target.searchPage },
        data: { searchPage: nextPage },
      });
      if (advanced.count === 1 && target.linkedinCompanyId) {
        await prisma.extensionTask.create({
          data: {
            userId: task.userId,
            kind: "SEARCH",
            payload: {
              searchUrl: buildCompanySearchUrl(
                run,
                target.linkedinCompanyId,
                nextPage,
              ),
              page: nextPage,
              targetId: target.id,
            },
            prospectingRunId: run.id,
            scheduledFor: new Date(),
          },
        });
      }
    }
  } else {
    await prisma.prospectingCompanyTarget.update({
      where: { id: target.id },
      data: { status: "DONE" },
    });
    // Humanized 2–5 min pause before the next company (sets discoveryDone when none remain).
    await startNextPendingTarget(run.id, interCompanyDelayMs());
  }

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
  const payload = (task.payload ?? {}) as { targetId?: string };
  // Count the failure; give up after too many so the run can still finish.
  const run = await prisma.prospectingRun.update({
    where: { id: task.prospectingRunId },
    data: { searchFailCount: { increment: 1 } },
  });
  if (run.targetType === "COMPANY" && payload.targetId) {
    if (run.searchFailCount >= SEARCH_FAIL_CAP) {
      await prisma.prospectingRun.update({
        where: { id: run.id },
        data: { searchFailCount: 0 },
      });
      const target = await prisma.prospectingCompanyTarget.findUnique({
        where: { id: payload.targetId },
      });
      if (target && target.status !== "REMOVED") {
        await failCompanyTarget(run.id, target, "search_failed"); // advances to the next company
      } else {
        await startNextPendingTarget(run.id);
      }
    }
    // Below the cap: prospecting-tick re-queues the same page for this target.
    return;
  }
  if (run.searchFailCount >= SEARCH_FAIL_CAP && !run.discoveryDone) {
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { discoveryDone: true } });
    await queueNextConnect(run.id);
  }
  // Otherwise prospecting-tick re-queues the same page.
}

async function handleConnectSuccess(task: TaskRow) {
  if (!task.connectionRequestId || !task.prospectingRunId) return;
  // Idempotent: only transition + count if not already SENT (guards at-least-once redelivery).
  const cr = await prisma.connectionRequest.findUnique({ where: { id: task.connectionRequestId } });
  if (!cr) return;

  const updated = await prisma.connectionRequest.updateMany({
    where: { id: task.connectionRequestId, status: { not: "SENT" } },
    data: { status: "SENT", sentAt: new Date() },
  });
  if (updated.count === 1) {
    await prisma.prospectingRun.update({
      where: { id: task.prospectingRunId },
      data: { totalSent: { increment: 1 } },
    });
    if (cr.companyTargetId) {
      await prisma.prospectingCompanyTarget.update({
        where: { id: cr.companyTargetId },
        data: { sentCount: { increment: 1 } },
      });
    }

    // Upsert a Contact so the person appears in the contacts list and can be
    // added to sequences/campaigns. Uses the same fields we scraped at discovery time.
    await prisma.contact.upsert({
      where: { ownerId_linkedinUrn: { ownerId: cr.ownerId, linkedinUrn: cr.linkedinUrn } },
      create: {
        ownerId: cr.ownerId,
        linkedinUrn: cr.linkedinUrn,
        linkedinUrl: cr.linkedinUrl,
        fullName: cr.fullName ?? "",
        headline: cr.headline,
        currentTitle: cr.currentTitle,
        currentCompany: cr.currentCompany,
        location: cr.location,
        lastSyncedAt: new Date(),
      },
      update: {
        // Only fill in blanks — don't overwrite richer data from a full LinkedIn sync.
        ...(cr.headline ? { headline: cr.headline } : {}),
        ...(cr.currentTitle ? { currentTitle: cr.currentTitle } : {}),
        ...(cr.currentCompany ? { currentCompany: cr.currentCompany } : {}),
        ...(cr.location ? { location: cr.location } : {}),
      },
    });
    await logProspectingEvent({ runId: task.prospectingRunId, type: "SENT", connectionRequestId: task.connectionRequestId, message: cr.fullName ?? cr.linkedinUrl });
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
    if (task.prospectingRunId) {
      await logProspectingEvent({ runId: task.prospectingRunId, type: "CHECKPOINT", connectionRequestId: task.connectionRequestId, message: "החשבון סומן ע\"י לינקדאין — מושהה ל-24 שעות" });
    }
  }
  // Already pending/connected is not a failure — the relationship already exists. Mark SENT.
  if (task.errorCode === "already_pending" || task.errorCode === "already_connected") {
    if (task.connectionRequestId) {
      const updated = await prisma.connectionRequest.updateMany({
        where: { id: task.connectionRequestId, status: { not: "SENT" } },
        data: { status: "SENT", sentAt: new Date() },
      });
      if (updated.count === 1 && task.prospectingRunId) {
        await prisma.prospectingRun.update({
          where: { id: task.prospectingRunId },
          data: { totalSent: { increment: 1 } },
        });
      }
    }
    if (task.prospectingRunId) {
      await logProspectingEvent({
        runId: task.prospectingRunId,
        type: task.errorCode === "already_pending" ? "ALREADY_PENDING" : "ALREADY_CONNECTED",
        connectionRequestId: task.connectionRequestId,
      });
      await releaseConnectSlot(task.prospectingRunId);
      await maybeCompleteOrContinue(task.prospectingRunId);
    }
    return;
  }
  // Follow-only profile (creator / open-profile with no Connect action): you cannot send a
  // connection request, so this is an intentional SKIP — not a failure. Keeps the failure stats
  // clean and lets the run move on.
  if (task.errorCode === "follow_only") {
    if (task.connectionRequestId) {
      await prisma.connectionRequest.updateMany({
        where: { id: task.connectionRequestId, status: { notIn: ["SENT", "FAILED"] } },
        data: { status: "SKIPPED", skipReason: "follow_only" },
      });
    }
    if (task.prospectingRunId) {
      await logProspectingEvent({
        runId: task.prospectingRunId,
        type: "SKIPPED",
        connectionRequestId: task.connectionRequestId,
        message: "פרופיל עוקב-בלבד (אין אפשרות לשלוח בקשת חברות)",
        detail: { skipReason: "follow_only" },
      });
      await releaseConnectSlot(task.prospectingRunId);
      await maybeCompleteOrContinue(task.prospectingRunId);
    }
    return;
  }
  if (task.connectionRequestId) {
    await prisma.connectionRequest.updateMany({
      where: { id: task.connectionRequestId, status: { notIn: ["SENT", "FAILED"] } },
      data: { status: "FAILED", errorCode: task.errorCode, errorMessage: task.errorMessage },
    });
  }
  if (task.connectionRequestId && task.prospectingRunId) {
    await logProspectingEvent({
      runId: task.prospectingRunId,
      type: "FAILED",
      connectionRequestId: task.connectionRequestId,
      message: task.errorMessage ?? task.errorCode ?? "unknown",
      detail: { errorCode: task.errorCode },
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

  if (run.targetType === "COMPANY") {
    // Company runs COMPLETE (no 24h re-discovery).
    await maybeCompleteCompanyRun(runId);
    return;
  }

  const [remaining, liveConnect] = await Promise.all([
    prisma.connectionRequest.count({ where: { runId, status: { in: ["DISCOVERED", "QUEUED"] } } }),
    prisma.extensionTask.findFirst({
      where: { prospectingRunId: runId, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
      select: { id: true },
    }),
  ]);
  if (remaining === 0 && !liveConnect && !run.nextDiscoveryAt) {
    // Recurring routine: the current pool is exhausted, but instead of COMPLETING we schedule the
    // next discovery sweep so the run keeps catching newly-matching people. The run stays RUNNING
    // (so the UI shows it as active/waiting, not completed). prospecting-tick re-discovers when due.
    await prisma.prospectingRun.update({
      where: { id: runId },
      data: { nextDiscoveryAt: new Date(Date.now() + REDISCOVERY_INTERVAL_MS) },
    });
  }
}

export const extensionTaskResult = inngest.createFunction(
  { id: "extension-task-result", triggers: [{ event: "extension.task.completed" as const }] },
  extensionTaskResultHandler
);
