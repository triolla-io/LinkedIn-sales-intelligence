import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const updated = await prisma.campaign.updateMany({
      where: { id, ownerId: ctx.effectiveUserId, status: "PAUSED" },
      data: { status: "RUNNING" },
    });
    if (updated.count === 0) return NextResponse.json({ error: "campaign not PAUSED or not found" }, { status: 409 });

    const pending = await prisma.campaignRecipient.findMany({
      where: { campaignId: id, status: "PENDING" },
      select: { id: true },
    });
    for (const r of pending) {
      await inngest.send({ name: "campaign.send-one", data: { recipientId: r.id } });
    }

    return NextResponse.json({ ok: true });
  })(req);
}
