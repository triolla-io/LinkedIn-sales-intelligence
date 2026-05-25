import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; enrollmentId: string }> }
) {
  const { id: sequenceId, enrollmentId } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const enrollment = await prisma.sequenceEnrollment.findFirst({
      where: { id: enrollmentId, sequenceId, sequence: { ownerId: ctx.effectiveUserId } },
    });
    if (!enrollment) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { count } = await prisma.sequenceStepExecution.updateMany({
      where: { enrollmentId, status: "SKIPPED" },
      data: { status: "PENDING" },
    });

    return NextResponse.json({ ok: true, restored: count });
  })(req);
}
