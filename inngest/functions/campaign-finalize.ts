import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/linkedin/sse-bus";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignFinalizeHandler({ event }: any) {
  const { campaignId } = event.data as { campaignId: string };
  const pending = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["PENDING", "SENDING"] } },
  });
  if (pending > 0) return;
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "RUNNING") return;
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  publish(campaign.ownerId, {
    type: "campaign:update",
    data: { campaignId },
  });
}

export const campaignFinalize = inngest.createFunction(
  { id: "campaign-finalize", triggers: [{ event: "campaign.finalize" as const }] },
  campaignFinalizeHandler
);
