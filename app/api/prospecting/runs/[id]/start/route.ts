import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_r: NextRequest, ctx) => {
    const run = await prisma.prospectingRun.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (run.status !== "DRAFT" && run.status !== "PAUSED") {
      return NextResponse.json({ error: "only DRAFT or PAUSED runs can be started" }, { status: 409 });
    }
    await prisma.prospectingRun.update({ where: { id }, data: { status: "RUNNING" } });
    await inngest.send({ name: "prospecting.start" as const, data: { runId: id } });
    return NextResponse.json({ ok: true });
  })(req);
}
