import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";
import { waClient } from "@/lib/whatsapp/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req: NextRequest, ctx) => {
    const campaign = await prisma.campaign.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (campaign.status !== "DRAFT") return NextResponse.json({ error: "campaign must be DRAFT to start" }, { status: 409 });

    if (campaign.channel === "LINKEDIN") {
      const linkedinSession = await prisma.linkedinSession.findUnique({ where: { userId: ctx.effectiveUserId } });
      if (!linkedinSession || linkedinSession.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "LINKEDIN_NOT_CONNECTED", message: "Connect your LinkedIn account before starting this campaign." },
          { status: 403 }
        );
      }
    }

    if (campaign.channel === "WHATSAPP") {
      const { status } = await waClient.status(ctx.effectiveUserId);
      if (status !== "CONNECTED") {
        return NextResponse.json(
          { error: "WHATSAPP_NOT_CONNECTED", message: "Connect your WhatsApp account before starting this campaign." },
          { status: 403 }
        );
      }
    }

    await prisma.campaign.update({ where: { id }, data: { status: "QUEUED" } });
    await inngest.send({ name: "campaign.start", data: { campaignId: id } });
    return NextResponse.json({ ok: true });
  })(req);
}
