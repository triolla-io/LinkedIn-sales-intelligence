import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const campaign = await prisma.campaign.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (campaign.status === "CANCELLED") return NextResponse.json({ error: "campaign is already CANCELLED" }, { status: 409 });

    await prisma.campaign.update({
      where: { id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  })(req);
}
