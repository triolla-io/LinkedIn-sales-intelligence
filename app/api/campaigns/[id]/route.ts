import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      include: {
        template: true,
        recipients: {
          include: { contact: { select: { fullName: true, currentTitle: true, currentCompany: true } } },
          orderBy: { scheduledAt: "asc" },
        },
      },
    });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ campaign });
  })(req);
}
