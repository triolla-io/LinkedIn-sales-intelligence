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

    const requests = await prisma.connectionRequest.findMany({
      where: { runId: id, ownerId: ctx.effectiveUserId, status: "SENT" },
      orderBy: { sentAt: "desc" },
    });
    return NextResponse.json({ run, requests });
  })(req);
}
