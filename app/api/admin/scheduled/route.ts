import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  return withTenant(async (_req, ctx) => {
    const now = new Date();

    const [executions, tasks] = await Promise.all([
      prisma.sequenceStepExecution.findMany({
        where: { status: "PENDING", enrollment: { ownerId: ctx.effectiveUserId } },
        orderBy: { scheduledAt: "asc" },
        take: 100,
        include: {
          enrollment: {
            include: {
              contact: { select: { fullName: true, phone: true, email: true } },
              sequence: { select: { name: true } },
            },
          },
          step: { select: { channel: true, stepNumber: true } },
        },
      }),
      prisma.extensionTask.findMany({
        where: { userId: ctx.effectiveUserId, status: "PENDING" },
        orderBy: { scheduledFor: "asc" },
        take: 50,
      }),
    ]);

    const formatDiff = (d: Date) => {
      const diffMin = Math.round((d.getTime() - now.getTime()) / 60_000);
      if (diffMin < 0) return `עבר לפני ${Math.abs(diffMin)} דק'`;
      if (diffMin < 60) return `עוד ${diffMin} דק'`;
      if (diffMin < 1440) return `עוד ${Math.round(diffMin / 60)} שע'`;
      return `עוד ${Math.round(diffMin / 1440)} ימים`;
    };

    return NextResponse.json({
      now: now.toISOString(),
      executions: executions.map((e) => ({
        id: e.id,
        channel: e.step.channel,
        stepNumber: e.step.stepNumber,
        contact: e.enrollment.contact.fullName,
        phone: e.enrollment.contact.phone,
        email: e.enrollment.contact.email,
        sequence: e.enrollment.sequence.name,
        scheduledAt: e.scheduledAt.toISOString(),
        inHuman: formatDiff(e.scheduledAt),
        overdue: e.scheduledAt < now,
      })),
      extensionTasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        scheduledFor: t.scheduledFor.toISOString(),
        inHuman: formatDiff(t.scheduledFor),
        overdue: t.scheduledFor < now,
      })),
    });
  })(req);
}
