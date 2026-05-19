import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { id } = params instanceof Promise ? await params : params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const campaign = await prisma.campaign.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (campaign.status !== "DRAFT") return NextResponse.json({ error: "campaign must be DRAFT to start" }, { status: 409 });

    await prisma.campaign.update({ where: { id }, data: { status: "QUEUED" } });
    await inngest.send({ name: "campaign.start", data: { campaignId: id } });
    return NextResponse.json({ ok: true });
  })(req);
}
