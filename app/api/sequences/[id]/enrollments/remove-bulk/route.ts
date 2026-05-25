import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sequenceId } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const body = await req.json().catch(() => ({}));
    const { enrollmentIds } = body as { enrollmentIds?: string[] };

    if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
      return NextResponse.json({ error: "enrollmentIds required" }, { status: 400 });
    }

    // Verify all enrollments belong to this sequence and owner
    const owned = await prisma.sequenceEnrollment.findMany({
      where: {
        id: { in: enrollmentIds },
        sequenceId,
        sequence: { ownerId: ctx.effectiveUserId },
      },
      select: { id: true },
    });
    const ownedIds = owned.map((e) => e.id);

    if (ownedIds.length !== enrollmentIds.length) {
      return NextResponse.json({ error: "some enrollments not found or not authorized" }, { status: 403 });
    }

    const { count } = await prisma.sequenceStepExecution.updateMany({
      where: { enrollmentId: { in: ownedIds }, status: "PENDING" },
      data: { status: "SKIPPED" },
    });

    return NextResponse.json({ ok: true, skipped: count });
  })(req);
}
