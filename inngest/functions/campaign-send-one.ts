import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { checkSendQuota } from "@/lib/campaigns/throttle";
import { publish } from "@/lib/linkedin/sse-bus";
import { computeNextScheduledFor } from "@/lib/extension/task-scheduler";

const MAX_ATTEMPTS = 3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignSendOneHandler({ event }: any) {
  const { recipientId } = event.data as { recipientId: string };

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: {
      campaign: {
        include: {
          owner: { select: { timezone: true } },
        },
      },
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
    const linkedinUrl = recipient.contact.linkedinUrl;
    if (!linkedinUrl) {
      await prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: { status: "FAILED", errorMessage: "missing_linkedin_url" },
      });
      await inngest.send({ name: "campaign.finalize", data: { campaignId: recipient.campaignId } });
      return;
    }

    const text = recipient.renderedBody ?? "";
    const { sentTodayCount, sentLastHourCount, lastSentAt } = await getSendStats(recipient.campaign.ownerId);

    const scheduledFor = computeNextScheduledFor({
      timezone: recipient.campaign.owner?.timezone ?? "Asia/Jerusalem",
      workingHoursStart: 9,
      workingHoursEnd: 18,
      weekdaysOnly: false,
      lastSentAt,
      sentTodayCount,
      sentLastHourCount,
      dailyCap: 30,
      hourlyCap: 8,
    });

    await prisma.extensionTask.create({
      data: {
        userId: recipient.campaign.ownerId,
        kind: "SEND",
        payload: { linkedinUrl, text, recipientName: recipient.contact.fullName ?? "" },
        recipientId: recipient.id,
        scheduledFor,
      },
    });

    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "QUEUED" },
    });
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

async function getSendStats(userId: string) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [today, lastHour, last] = await Promise.all([
    prisma.sentMessage.count({ where: { senderId: userId, sentAt: { gte: dayAgo } } }),
    prisma.sentMessage.count({ where: { senderId: userId, sentAt: { gte: hourAgo } } }),
    prisma.sentMessage.findFirst({ where: { senderId: userId }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
  ]);
  return { sentTodayCount: today, sentLastHourCount: lastHour, lastSentAt: last?.sentAt ?? null };
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
