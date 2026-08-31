import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { recordJobChangeIfAny } from "@/lib/job-check/detect-change";
import { RADAR_SCRAPE_STALE_DAYS } from "@/lib/job-check/dispatch";
import { maybeCompleteEnrollment } from "@/lib/sequences/gating";
import { persistCandidates } from "@/lib/prospecting/candidates";
import { queueNextConnect, releaseConnectSlot, stampWarmupStart, SEARCH_FAIL_CAP } from "@/lib/prospecting/connect-scheduler";
import type { ScrapedCard } from "@/lib/prospecting/filter";
import { buildSearchUrl, parseSearchTitles } from "@/lib/prospecting/search-url";
import { logProspectingEvent } from "@/lib/prospecting/events";
import { ingestScrapedPosts } from "@/lib/post-comments/ingest";
import {
  buildCompanySearchUrl,
  enqueueCompanySearchTask,
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
  } else if (task.kind === "PREPARE_MESSAGE") {
    if (task.status === "DONE") {
      await handlePrepareSuccess(task);
    } else if (task.status === "FAILED") {
      await handlePrepareFailure(task);
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
  } else if (task.kind === "SCRAPE_PROFILE" && task.status === "DONE") {
    await handleScrapeProfile(task);
  } else if (task.kind === "SCRAPE_PROFILE" && task.status === "FAILED") {
    await markScrapeProfileChecked(task);
  } else if (task.kind === "SCRAPE_POSTS" && task.status === "DONE") {
    await ingestScrapedPosts(task);
  } else if (task.kind === "PREPARE_COMMENT") {
    if (task.status === "DONE") {
      await handlePrepareSuccess(task);
    } else if (task.status === "FAILED") {
      await handlePrepareFailure(task);
    }
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

  if (task.companySignalDraftId) {
    const draft = await prisma.companySignalDraft.findUnique({
      where: { id: task.companySignalDraftId },
      select: { id: true, contactId: true },
    });
    if (draft) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: draft.contactId,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.companySignalDraft.update({
        where: { id: draft.id },
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

  if (task.companySignalDraftId) {
    await prisma.companySignalDraft.updateMany({
      where: { id: task.companySignalDraftId, status: "APPROVED" },
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

// PREPARE_MESSAGE: the extension typed the draft into LinkedIn compose and handed the
// open tab to the user — nothing was sent. The SentMessage row is recorded only when
// the user confirms "שלחתי" in the review UI, so success here just advances the status.
async function handlePrepareSuccess(task: TaskRow) {
  if (task.companySignalDraftId) {
    await prisma.companySignalDraft.updateMany({
      where: { id: task.companySignalDraftId, status: "APPROVED" },
      data: { status: "PREPARED" },
    });
    return;
  }
  if (task.articleMatchId) {
    await prisma.articleMatch.updateMany({
      where: { id: task.articleMatchId, status: "PREPARING" },
      data: { status: "PREPARED" },
    });
    return;
  }
  if (task.techDraftId) {
    await prisma.techOpportunityDraft.updateMany({
      where: { id: task.techDraftId, status: "PREPARING" },
      data: { status: "PREPARED" },
    });
    return;
  }
  if (task.radarDraftId) {
    await prisma.radarDraft.updateMany({
      where: { id: task.radarDraftId, status: "PREPARING" },
      data: { status: "PREPARED" },
    });
    return;
  }
  if (task.postCommentDraftId) {
    await prisma.postCommentDraft.updateMany({
      where: { id: task.postCommentDraftId, status: "PREPARING" },
      data: { status: "PREPARED" },
    });
  }
}

async function handlePrepareFailure(task: TaskRow) {
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
  // Return the item to the review queue so the user can simply retry.
  if (task.companySignalDraftId) {
    await prisma.companySignalDraft.updateMany({
      where: { id: task.companySignalDraftId, status: "APPROVED" },
      data: { status: "PENDING_REVIEW" },
    });
    return;
  }
  if (task.articleMatchId) {
    await prisma.articleMatch.updateMany({
      where: { id: task.articleMatchId, status: "PREPARING" },
      data: { status: "SUGGESTED" },
    });
    return;
  }
  // Return the draft to the review queue so the user can simply retry.
  if (task.techDraftId) {
    await prisma.techOpportunityDraft.updateMany({
      where: { id: task.techDraftId, status: "PREPARING" },
      data: { status: "PENDING_REVIEW" },
    });
    return;
  }
  if (task.radarDraftId) {
    await prisma.radarDraft.updateMany({
      where: { id: task.radarDraftId, status: "PREPARING" },
      data: { status: "PENDING_REVIEW" },
    });
    return;
  }
  if (task.postCommentDraftId) {
    await prisma.postCommentDraft.updateMany({
      where: { id: task.postCommentDraftId, status: "PREPARING" },
      data: { status: "PENDING_REVIEW" },
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
  // Kick off discovery at the first title (searchTitleIndex 0, page 1). enqueueCompanySearchTask
  // sets SEARCHING and creates the SEARCH task — or, if there are no searchable titles, finishes
  // the company and moves on.
  await enqueueCompanySearchTask(
    run,
    {
      id: target.id,
      name: target.name,
      linkedinUrl: target.linkedinUrl,
      linkedinCompanyId: result.companyId,
      searchPage: target.searchPage,
      searchTitleIndex: target.searchTitleIndex,
    },
    target.searchPage,
  );
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

  // We search ONE title at a time; keep only people whose headline actually matches it.
  const titles = parseSearchTitles(run.keywords);
  const currentTitle = titles[target.searchTitleIndex];
  const { inserted, filtered } = await persistCandidates(
    task.userId,
    run.id,
    result.candidates ?? [],
    target.id,
    currentTitle,
  );

  // LinkedIn's keyword search is full-text, so a company page routinely returns people who merely
  // mention the term. Dropping them is right; dropping them SILENTLY is what made adi's Playtika run
  // (2026-08-18) look like a clean, empty success — 25 people scanned, 25 filtered, nothing recorded.
  if (filtered > 0 && inserted === 0) {
    await logProspectingEvent({
      runId: run.id,
      type: "SKIPPED",
      message: `${target.name} · ${currentTitle ?? "—"} — נסרקו ${filtered} אנשים, אף אחד לא בתפקיד הזה`,
      detail: {
        companyTargetId: target.id,
        title: currentTitle ?? null,
        scanned: filtered + inserted,
        matched: inserted,
      },
    });
  }

  if (run.status !== "RUNNING") return;
  if (run.searchFailCount > 0) {
    await prisma.prospectingRun.update({
      where: { id: run.id },
      data: { searchFailCount: 0 },
    });
  }

  const ownerFlags = await prisma.user.findUnique({
    where: { id: run.ownerId },
    select: { routineConnectionsEnabled: true },
  });
  const moduleEnabled = !ownerFlags || ownerFlags.routineConnectionsEnabled;
  // We search ONE title at a time (LinkedIn URL search can't OR a title list). searchPage
  // paginates the current title; searchTitleIndex walks the list. Company DONE = last title done.

  if (result.hasNextPage) {
    // More pages of the CURRENT title. Same module master-switch gate as keyword runs.
    if (moduleEnabled && currentTitle !== undefined) {
      const nextPage = target.searchPage + 1;
      // Guard on (searchPage, searchTitleIndex) so only one concurrent handler advances.
      const advanced = await prisma.prospectingCompanyTarget.updateMany({
        where: {
          id: target.id,
          searchPage: target.searchPage,
          searchTitleIndex: target.searchTitleIndex,
        },
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
                currentTitle,
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
    // Current title exhausted → move to the next title, or finish the company.
    const nextTitleIndex = target.searchTitleIndex + 1;
    const nextTitle = titles[nextTitleIndex];
    if (nextTitle !== undefined) {
      // Advance the title cursor (guarded); reset the page to 1 for the new title.
      const advanced = await prisma.prospectingCompanyTarget.updateMany({
        where: {
          id: target.id,
          searchTitleIndex: target.searchTitleIndex,
          status: "SEARCHING",
        },
        data: { searchTitleIndex: nextTitleIndex, searchPage: 1 },
      });
      if (advanced.count === 1 && moduleEnabled && target.linkedinCompanyId) {
        await prisma.extensionTask.create({
          data: {
            userId: task.userId,
            kind: "SEARCH",
            payload: {
              searchUrl: buildCompanySearchUrl(
                run,
                target.linkedinCompanyId,
                1,
                nextTitle,
              ),
              page: 1,
              targetId: target.id,
            },
            prospectingRunId: run.id,
            scheduledFor: new Date(),
          },
        });
      }
    } else {
      // All titles searched → company DONE; humanized pause before the next company.
      const done = await prisma.prospectingCompanyTarget.updateMany({
        where: { id: target.id, status: "SEARCHING" },
        data: { status: "DONE" },
      });
      if (done.count === 1) {
        await logCompanyYield(run.id, target.id, target.name, titles);
        await startNextPendingTarget(run.id, interCompanyDelayMs());
      }
    }
  }

  await queueNextConnect(run.id);
}

/**
 * One line per finished company, read off the persisted counters (not the last page's): "scanned N,
 * found M". A company that scanned people and matched none is the interesting case — it means the
 * searched titles are wrong for this company, which the customer can act on, so it says that.
 */
async function logCompanyYield(
  runId: string,
  targetId: string,
  name: string,
  titles: string[],
): Promise<void> {
  const totals = await prisma.prospectingCompanyTarget.findUnique({
    where: { id: targetId },
    select: { scannedCount: true, discoveredCount: true },
  });
  if (!totals || totals.scannedCount === 0) return; // nothing was returned at all — no counters to explain
  const message =
    totals.discoveredCount === 0
      ? `${name} — נסרקו ${totals.scannedCount} אנשים, אף אחד לא בתפקידים שביקשת (${titles.join(", ")}). כדאי לנסות תפקידים אחרים`
      : `${name} — נסרקו ${totals.scannedCount} אנשים, ${totals.discoveredCount} בתפקידים שביקשת`;
  await logProspectingEvent({
    runId,
    type: totals.discoveredCount === 0 ? "SKIPPED" : "DISCOVERED",
    message,
    detail: {
      companyTargetId: targetId,
      scanned: totals.scannedCount,
      matched: totals.discoveredCount,
      titles,
    },
  });
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
  await stampWarmupStart(task.userId);
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
      await stampWarmupStart(task.userId);
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

export async function handleScrapeProfile(task: TaskRow) {
  const payload = (task.payload ?? {}) as { contactId?: string };
  const result = (task.result ?? {}) as {
    title?: string | null; company?: string | null;
    headline?: string | null; about?: string | null;
    experience?: { title: string; company: string | null; dateRange: string | null; description?: string | null }[];
    // The deep scrape, extension 0.7.1. Optional because older installs coexist in the
    // field for as long as manual distribution takes.
    skills?: unknown;
    education?: { school: string; degree?: string | null; field?: string | null }[];
    /** 0.7.2: did the lazy-rendered lower page appear before the read. Absent on older builds. */
    revealed?: { scrolls?: number; found?: boolean; experience?: boolean; education?: boolean; viewport?: { w?: number; h?: number }; page?: { sections?: number; headings?: string[]; scrollVia?: string; docHeight?: number; hidden?: boolean } };
  };
  if (!payload.contactId) return;
  const contact = await prisma.contact.findUnique({
    where: { id: payload.contactId },
    select: {
      ownerId: true,
      jobSnapshotTitle: true,
      jobSnapshotCompany: true,
      // Fetched here, not a second round trip: this is the gate for the paid half of
      // this function (below). The radar source (dispatch.ts) can now produce a
      // SCRAPE_PROFILE task for an org that has "Job Changes" OFF — the scrape itself
      // is free (customer's own extension), but judging it is a real openrouterChat
      // call, and an org that turned the module off must not be billed for it, nor get
      // a ContactJobChange row / "Job Changes" list entry it never asked for.
      owner: { select: { org: { select: { jobCheckEnabled: true } } } },
    },
  });
  if (!contact) return;
  // Raw profile fields for the radar's layer 4. jobSnapshot* stays the job-change
  // module's private state — these are the fields everything else reads. Stamped on
  // EVERY successful scrape, even an old-extension one with no new fields, because
  // profileScrapedAt is the staleness clock a later poll loop depends on terminating.
  await prisma.contact.update({
    where: { id: payload.contactId },
    data: {
      profileScrapedAt: new Date(),
      ...(result.headline ? { headline: result.headline } : {}),
      ...(result.about ? { about: result.about.slice(0, 2000) } : {}),
      ...(Array.isArray(result.experience) && result.experience.length
        ? {
            experience: result.experience.slice(0, 5).map((e) => ({
              ...e,
              // The role's own free-text description — the person's account of their own
              // scope, and the strongest layer-4 FOUND source there is. Capped here as
              // well as in the page reader, because the cap is a storage decision.
              ...(typeof e.description === "string" ? { description: e.description.slice(0, 1500) } : {}),
            })),
          }
        : {}),
      // Absent means "an older extension sent this result", NEVER "the person has none":
      // writing null here would erase what a newer build already stored, and the two
      // builds coexist for as long as distribution takes.
      ...(Array.isArray(result.skills) && result.skills.length
        ? { skills: result.skills.filter((s): s is string => typeof s === "string").slice(0, 30) }
        : {}),
      ...(Array.isArray(result.education) && result.education.length
        ? { education: result.education.slice(0, 5) }
        : {}),
    },
  });
  // A DONE result that carried no About and no Experience is almost certainly a parser
  // miss, not a genuinely empty profile — and it is indistinguishable from success
  // everywhere else: profileScrapedAt was just stamped (above, deliberately), which is
  // exactly the clock the radar's dispatch source reads as "fresh". Left silent, a DOM
  // drift on live LinkedIn parks the person for a month with nobody the wiser. Say it.
  const gotExperience = Array.isArray(result.experience) && result.experience.length > 0;
  if (!result.about && !gotExperience) {
    // Two very different causes, and for weeks they were indistinguishable: a person who
    // published nothing, versus a page we read before it rendered. `revealed.found` is
    // what separates them (extension 0.7.2+). An empty read on a page that never
    // rendered is a BUG report, not a fact about the person.
    const reveal =
      result.revealed === undefined
        ? "extension predates the scroll fix, so this cannot be told apart from a genuinely empty profile"
        : result.revealed.found
          ? `page DID render (${result.revealed.scrolls ?? "?"} scrolls; experience section ${result.revealed.experience ? "present" : "ABSENT"}, education ${result.revealed.education ? "present" : "ABSENT"}) — so this person really published neither`
          : `page NEVER rendered its lower sections (${result.revealed.scrolls ?? "?"} scrolls, viewport ${result.revealed.viewport?.w ?? "?"}x${result.revealed.viewport?.h ?? "?"}) — a READ failure, not an empty profile; scrollVia=${result.revealed.page?.scrollVia ?? "?"}, ${result.revealed.page?.sections ?? "?"} sections, doc ${result.revealed.page?.docHeight ?? "?"}px, hidden=${result.revealed.page?.hidden ?? "?"}, headings=[${(result.revealed.page?.headings ?? []).join(", ")}]`;
    console.warn(
      `[job-check] SCRAPE_PROFILE returned no about and no experience for contact=${payload.contactId} — profileScrapedAt was still stamped, so the radar will not retry this person for ${RADAR_SCRAPE_STALE_DAYS} days. ${reveal}`
    );
  }

  const freshTitle = result.title ?? null;
  const freshCompany = result.company ?? null;
  // First run: no snapshot yet — seed the baseline and do NOT detect a change. Seeded
  // unconditionally (even with Job Changes OFF): it costs nothing, touches only this
  // contact's own private snapshot fields, and gives a correct baseline for the day the
  // org turns the module on — without it, enabling later would compare against a stale
  // or missing snapshot and could misfire a "change" that is really just the gap in time
  // the module sat off.
  if (contact.jobSnapshotTitle === null && contact.jobSnapshotCompany === null) {
    await prisma.contact.update({
      where: { id: payload.contactId },
      data: { jobSnapshotTitle: freshTitle, jobSnapshotCompany: freshCompany, lastJobCheckAt: new Date() },
    });
    return;
  }
  // The paid half. judgeJobChange (called inside recordJobChangeIfAny) is a real
  // openrouterChat call, and a real hit can create a ContactJobChange row and add the
  // contact to the "Job Changes" list — none of that belongs to an org that switched
  // the module off. Until the radar became a second SCRAPE_PROFILE producer, this was
  // safe by accident: the only producer required jobCheckEnabled at dispatch time. The
  // radar producer doesn't, so the gate has to live here too.
  if (!contact.owner.org.jobCheckEnabled) {
    // Refresh the baseline on the way out. With the module OFF nothing else advances the
    // snapshot — recordJobChangeIfAny is where that normally happens — so the stored
    // title/company would keep ageing while the radar goes on scraping this person. The
    // day the org switches "Job Changes" ON, that stale baseline is what the first
    // comparison runs against, and a move made months ago reads as brand new: a
    // congratulation that arrives embarrassingly late. Snapshot only — no judgement, no
    // ContactJobChange, and NOT lastJobCheckAt, which is the disabled module's own
    // counter (lib/job-check/stats.ts).
    await prisma.contact.update({
      where: { id: payload.contactId },
      data: {
        jobSnapshotTitle: freshTitle ?? contact.jobSnapshotTitle,
        jobSnapshotCompany: freshCompany ?? contact.jobSnapshotCompany,
      },
    });
    return;
  }
  await recordJobChangeIfAny({
    contactId: payload.contactId,
    ownerId: contact.ownerId,
    snapshotTitle: contact.jobSnapshotTitle,
    snapshotCompany: contact.jobSnapshotCompany,
    freshTitle,
    freshCompany,
  });
}

export async function markScrapeProfileChecked(task: TaskRow) {
  const payload = (task.payload ?? {}) as { contactId?: string };
  if (!payload.contactId) return;
  // The same org gate the DONE path applies, for the same reason: the radar produces
  // SCRAPE_PROFILE tasks for orgs with "Job Changes" OFF, and lastJobCheckAt is that
  // module's private counter — lib/job-check/stats.ts reads it as "scanned". A radar
  // failure must not show up in the numbers of a module the org switched off.
  const contact = await prisma.contact.findUnique({
    where: { id: payload.contactId },
    select: { owner: { select: { org: { select: { jobCheckEnabled: true } } } } },
  });
  if (!contact?.owner.org.jobCheckEnabled) return;
  await prisma.contact.update({
    where: { id: payload.contactId },
    data: { lastJobCheckAt: new Date() },
  });
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
