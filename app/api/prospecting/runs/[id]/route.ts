import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { computeRunStatusSummary } from "@/lib/prospecting/run-status";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [requests, tasks, events, nextTask, sentToday, sentThisWeek] = await Promise.all([
      prisma.connectionRequest.findMany({
        where: { runId: id, ownerId: ctx.effectiveUserId },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.extensionTask.findMany({
        where: { prospectingRunId: id },
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, status: true, errorCode: true, errorMessage: true, createdAt: true, completedAt: true, claimedAt: true },
      }),
      prisma.prospectingEvent.findMany({
        where: { runId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { type: true, message: true, createdAt: true, connectionRequestId: true },
      }),
      prisma.extensionTask.findFirst({
        where: { prospectingRunId: id, kind: "CONNECT", status: { in: ["PENDING", "CLAIMED"] } },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      }),
      prisma.connectionRequest.count({ where: { ownerId: ctx.effectiveUserId, status: "SENT", sentAt: { gte: dayAgo } } }),
      prisma.connectionRequest.count({ where: { ownerId: ctx.effectiveUserId, status: "SENT", sentAt: { gte: weekAgo } } }),
    ]);

    const statusCounts = {
      discovered: requests.filter((r) => r.status === "DISCOVERED").length,
      queued: requests.filter((r) => r.status === "QUEUED").length,
      sent: requests.filter((r) => r.status === "SENT").length,
      failed: requests.filter((r) => r.status === "FAILED").length,
      skipped: requests.filter((r) => r.status === "SKIPPED").length,
    };

    const isTransientSearch = (t: { kind: string; errorCode: string | null }) => t.kind === "SEARCH" && t.errorCode === "tab_load";
    const taskStats = {
      search: {
        pending: tasks.filter((t) => t.kind === "SEARCH" && (t.status === "PENDING" || t.status === "CLAIMED")).length,
        done: tasks.filter((t) => t.kind === "SEARCH" && t.status === "DONE").length,
        failed: tasks.filter((t) => t.kind === "SEARCH" && t.status === "FAILED" && !isTransientSearch(t)).length,
        retried: tasks.filter((t) => t.status === "FAILED" && isTransientSearch(t)).length,
      },
      connect: {
        pending: tasks.filter((t) => t.kind === "CONNECT" && (t.status === "PENDING" || t.status === "CLAIMED")).length,
        done: tasks.filter((t) => t.kind === "CONNECT" && t.status === "DONE").length,
        failed: tasks.filter((t) => t.kind === "CONNECT" && t.status === "FAILED" && t.errorCode !== "follow_only").length,
        skipped: tasks.filter((t) => t.kind === "CONNECT" && t.errorCode === "follow_only").length,
      },
      recentFailures: tasks
        .filter((t) => t.status === "FAILED" && t.errorCode && t.errorCode !== "follow_only" && !isTransientSearch(t))
        .slice(0, 5)
        .map((t) => ({ kind: t.kind, errorCode: t.errorCode, errorMessage: t.errorMessage, at: t.completedAt ?? t.createdAt })),
      lastActivity: tasks[0]?.claimedAt ?? tasks[0]?.createdAt ?? null,
    };

    const summary = computeRunStatusSummary({
      status: run.status,
      pausedUntil: run.pausedUntil,
      nextScheduledFor: nextTask?.scheduledFor ?? null,
      nextDiscoveryAt: run.nextDiscoveryAt,
      sentToday, dailyCap: run.dailyCap, sentThisWeek, weeklyCap: run.weeklyCap, now,
    });

    return NextResponse.json({ run, requests, statusCounts, events, taskStats, summary });
  })(req);
}
