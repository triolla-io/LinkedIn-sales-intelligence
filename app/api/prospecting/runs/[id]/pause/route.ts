import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (run.status !== "RUNNING") {
      return NextResponse.json({ error: "only RUNNING runs can be paused" }, { status: 409 });
    }
    await prisma.prospectingRun.update({ where: { id }, data: { status: "PAUSED" } });
    // Cancel pending tasks so nothing fires while paused; resume re-queues from prospecting.start.
    await prisma.extensionTask.updateMany({
      where: { prospectingRunId: id, status: "PENDING" },
      data: { status: "FAILED", errorCode: "paused" },
    });
    return NextResponse.json({ ok: true });
  })(req);
}
