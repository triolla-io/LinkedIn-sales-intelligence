import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const [requests, tasks] = await Promise.all([
      prisma.connectionRequest.findMany({
        where: { runId: id, ownerId: ctx.effectiveUserId, status: "SENT" },
        orderBy: { sentAt: "desc" },
      }),
      prisma.extensionTask.findMany({
        where: { prospectingRunId: id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
          claimedAt: true,
        },
      }),
    ]);

    const taskStats = {
      search: {
        pending: tasks.filter((t) => t.kind === "SEARCH" && (t.status === "PENDING" || t.status === "CLAIMED")).length,
        done: tasks.filter((t) => t.kind === "SEARCH" && t.status === "DONE").length,
        failed: tasks.filter((t) => t.kind === "SEARCH" && t.status === "FAILED").length,
      },
      connect: {
        pending: tasks.filter((t) => t.kind === "CONNECT" && (t.status === "PENDING" || t.status === "CLAIMED")).length,
        done: tasks.filter((t) => t.kind === "CONNECT" && t.status === "DONE").length,
        failed: tasks.filter((t) => t.kind === "CONNECT" && t.status === "FAILED").length,
      },
      recentFailures: tasks
        .filter((t) => t.status === "FAILED" && t.errorCode)
        .slice(0, 5)
        .map((t) => ({ kind: t.kind, errorCode: t.errorCode, errorMessage: t.errorMessage, at: t.completedAt ?? t.createdAt })),
      lastActivity: tasks[0]?.claimedAt ?? tasks[0]?.createdAt ?? null,
    };

    return NextResponse.json({ run, requests, taskStats });
  })(req);
}
