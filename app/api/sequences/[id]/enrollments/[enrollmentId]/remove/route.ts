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
      where: { enrollmentId, status: "PENDING" },
      data: { status: "SKIPPED" },
    });

    // Mark the enrollment itself as removed. This both stops dispatch (the tick
    // only sends for status: "ACTIVE") and — crucially — keeps the row present
    // so the tick's "enroll new list members" step won't re-create it (that
    // check is keyed on contactId regardless of status).
    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "UNSUBSCRIBED" },
    });

    return NextResponse.json({ ok: true, skipped: count });
  })(req);
}
