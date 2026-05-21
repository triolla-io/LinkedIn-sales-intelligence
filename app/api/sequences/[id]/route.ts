import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const sequence = await prisma.sequence.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: {
        steps: { orderBy: { stepNumber: "asc" }, include: { template: { select: { name: true } } } },
        contactList: { select: { name: true } },
        enrollments: {
          select: {
            id: true,
            status: true,
            contact: { select: { fullName: true, currentTitle: true, currentCompany: true } },
            executions: {
              orderBy: { step: { stepNumber: "asc" } },
              select: { status: true, sentAt: true, step: { select: { stepNumber: true, channel: true } } },
            },
          },
        },
      },
    });
    if (!sequence) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ sequence });
  })(req);
}
