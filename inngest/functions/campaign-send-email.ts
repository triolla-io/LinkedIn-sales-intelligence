import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";
import { sendEmail } from "@/lib/gmail/client";

const MAX_ATTEMPTS = 3;
const DEFAULT_DAY_LIMIT = 200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendEmailHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: true, contact: true },
  });
  if (!recipient || recipient.status !== "PENDING") return;
  if (recipient.campaign.channel !== "EMAIL") return;
  if (recipient.campaign.status !== "RUNNING") return;

  const dailyLimit = (recipient.campaign as { dailyLimit?: number | null }).dailyLimit ?? DEFAULT_DAY_LIMIT;
  const quota = await checkSendQuota(recipient.campaign.ownerId, {
    dayLimit: dailyLimit,
    prefix: "email:send:",
  });
  if (!quota.ok) {
    await inngest.send({
      name: "campaign.send-email",
      data: { recipientId },
      ts: Date.now() + quota.retryAfterSec * 1000,
    });
    return;
  }

  const toEmail = recipient.contact.email;
  if (!toEmail) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "FAILED", errorMessage: "no email address" },
    });
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { status: "SENDING", attemptCount: { increment: 1 } },
  });

  try {
    const subject = (recipient.campaign as { subject?: string | null }).subject ?? recipient.campaign.name;
    await sendEmail(recipient.campaign.ownerId, {
      to: toEmail,
      subject,
      body: recipient.renderedBody ?? "",
    });

    const sent = await prisma.sentMessage.create({
      data: {
        senderId: recipient.campaign.ownerId,
        actorId: recipient.campaign.ownerId,
        contactId: recipient.contactId,
        templateId: recipient.campaign.templateId,
        body: recipient.renderedBody ?? "",
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "SENT", sentMessageId: sent.id, sentAt: new Date() },
    });
    publish(recipient.campaign.ownerId, {
      type: "campaign:sent",
      data: { recipientId, campaignId: recipient.campaignId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const shouldRetry = recipient.attemptCount + 1 < MAX_ATTEMPTS;
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: {
        status: shouldRetry ? "PENDING" : "FAILED",
        errorMessage: message,
      },
    });
    if (shouldRetry) {
      await inngest.send({ name: "campaign.send-email", data: { recipientId } });
    }
  } finally {
    await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
  }
}

export const campaignSendEmail = inngest.createFunction(
  { id: "campaign-send-email", triggers: [{ event: "campaign.send-email" as const }] },
  campaignSendEmailHandler
);
