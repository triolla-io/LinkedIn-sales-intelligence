import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import {
  releaseConnectSlot,
  queueNextConnect,
} from "@/lib/prospecting/connect-scheduler";
import { startNextPendingTarget } from "@/lib/prospecting/company-discovery";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; targetId: string }> },
) {
  const { id, targetId } = await params;
  return withTenant(async (_r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const target = await prisma.prospectingCompanyTarget.findFirst({
      where: { id: targetId, runId: id },
    });
    if (!target)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    await prisma.prospectingCompanyTarget.update({
      where: { id: targetId },
      data: { status: "REMOVED" },
    });

    // Cancel this company's live discovery tasks (RESOLVE/SEARCH payloads carry targetId).
    // CLAIMED tasks can't be retracted — their result handler sees REMOVED and drops the page.
    const cancelledDiscovery = await prisma.extensionTask.updateMany({
      where: {
        prospectingRunId: id,
        status: "PENDING",
        payload: { path: ["targetId"], equals: targetId },
      },
      data: { status: "CANCELLED" },
    });

    // Cancel unsent people: their PENDING CONNECT tasks first, then the request rows.
    const unsent = await prisma.connectionRequest.findMany({
      where: {
        companyTargetId: targetId,
        status: { in: ["DISCOVERED", "QUEUED"] },
      },
      select: { id: true },
    });
    const unsentIds = unsent.map((u) => u.id);
    let cancelledConnects = 0;
    if (unsentIds.length > 0) {
      const res = await prisma.extensionTask.updateMany({
        where: {
          prospectingRunId: id,
          kind: "CONNECT",
          status: "PENDING",
          connectionRequestId: { in: unsentIds },
        },
        data: { status: "CANCELLED" },
      });
      cancelledConnects = res.count;
      await prisma.connectionRequest.updateMany({
        where: { id: { in: unsentIds } },
        data: { status: "SKIPPED", skipReason: "company_removed" },
      });
    }

    // A cancelled CONNECT held the per-run slot (no result event will release it) — release and continue.
    if (cancelledConnects > 0) {
      await releaseConnectSlot(id);
      await queueNextConnect(id);
    }
    // If we cancelled the run's live discovery task, keep discovery moving.
    if (cancelledDiscovery.count > 0 && !run.discoveryDone) {
      await startNextPendingTarget(id);
    }

    return NextResponse.json({ ok: true, cancelled: unsentIds.length });
  })(req);
}
