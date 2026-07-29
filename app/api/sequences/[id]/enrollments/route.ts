import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { buildEnrollmentExecutions } from "@/lib/sequences/helpers";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (req: NextRequest, ctx) => {
    const body = await req.json();
    const { contactIds } = body as { contactIds?: unknown };

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json({ error: "contactIds required" }, { status: 400 });
    }

    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: {
        steps: {
          orderBy: { stepNumber: "asc" },
          select: { id: true, dayOffset: true, sendHour: true, sendMinute: true, sendHourEnd: true, sendMinuteEnd: true },
        },
      },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (sequence.steps.length === 0)
      return NextResponse.json({ error: "no steps configured" }, { status: 400 });

    await prisma.sequenceEnrollment.createMany({
      data: (contactIds as string[]).map((contactId) => ({
        sequenceId: id,
        contactId,
        status: "ACTIVE" as const,
      })),
      skipDuplicates: true,
    });

    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: { sequenceId: id, contactId: { in: contactIds as string[] } },
      select: {
        id: true,
        enrolledAt: true,
        executions: { select: { id: true }, take: 1 },
      },
    });

    const newEnrollments = enrollments.filter((e) => e.executions.length === 0);
    if (newEnrollments.length > 0) {
      await prisma.sequenceStepExecution.createMany({
        data: newEnrollments.flatMap((enr) =>
          buildEnrollmentExecutions(enr.enrolledAt, sequence.steps).map((row) => ({
            ...row,
            enrollmentId: enr.id,
          }))
        ),
        skipDuplicates: true,
      });
    }

    // Return full enrollment objects so the client can optimistically update state
    const fullEnrollments = await prisma.sequenceEnrollment.findMany({
      where: { id: { in: newEnrollments.map((e) => e.id) } },
      select: {
        id: true,
        contactId: true,
        status: true,
        enrolledAt: true,
        contact: { select: { fullName: true, currentTitle: true, currentCompany: true } },
        executions: {
          select: {
            status: true,
            sentAt: true,
            scheduledAt: true,
            step: { select: { stepNumber: true, channel: true, dayOffset: true } },
          },
          orderBy: { scheduledAt: "asc" },
        },
      },
    });

    return NextResponse.json({
      enrolled: newEnrollments.length,
      skipped: (contactIds as string[]).length - newEnrollments.length,
      newEnrollments: fullEnrollments,
    });
  })(req);
}
