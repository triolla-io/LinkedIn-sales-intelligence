import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";

const MAX_ATTEMPTS = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendOneHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: {
      campaign: true,
      contact: true,
    },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.channel !== "LINKEDIN") return;
  if (recipient.campaign.status !== "RUNNING") return;

  const quota = await checkSendQuota(recipient.campaign.ownerId);
  if (!quota.ok) {
    await inngest.send({ name: "campaign.send-one", data: { recipientId } });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  try {
    throw new Error("LinkedIn MCP client removed — reconnect the LinkedIn MCP service to restore sending");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const shouldRetry = recipient.attemptCount + 1 < MAX_ATTEMPTS;
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: shouldRetry ? "PENDING" : "FAILED", errorMessage: message },
    });
    if (shouldRetry) {
      await inngest.send({ name: "campaign.send-one", data: { recipientId } });
    }
  } finally {
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
  }
}

async function pauseCampaign(campaignId: string, actorId: string, reason: string) {
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
  await prisma.auditEvent.create({
    data: { actorId, action: "campaign.paused", payload: { reason, campaignId } },
  });
}

export const campaignSendOne = inngest.createFunction(
  { id: "campaign-send-one", triggers: [{ event: "campaign.send-one" as const }] },
  campaignSendOneHandler
);
