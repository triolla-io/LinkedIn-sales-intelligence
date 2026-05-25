import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/lib/campaigns/render-template";
import { resolveAudience, type AudienceSpec } from "@/lib/campaigns/audience";
import { jitterSeconds } from "@/lib/campaigns/throttle";

function firstName(full: string | null): string | null {
  if (!full) return null;
  const [f] = full.trim().split(/\s+/);
  return f ?? null;
}
function lastName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function campaignStartHandler({ event }: any) {
  const { campaignId } = event.data as { campaignId: string };
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, owner: { include: { org: true } } },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status !== "QUEUED") return; // idempotency guard: skip if already processed

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  const spec: AudienceSpec = (campaign.filterJson as AudienceSpec) ?? { contactIds: [] };
  const contactIds = await resolveAudience(campaign.ownerId, spec);
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } } });

  const sender = {
    firstName: firstName(campaign.owner.name),
    lastName:  lastName(campaign.owner.name),
    company:   campaign.owner.org?.name ?? null,
    title:     campaign.owner.title ?? null,
  };

  let cursor = Date.now();
  for (const contact of contacts) {
    const recipient = {
      firstName: firstName(contact.fullName),
      lastName:  lastName(contact.fullName),
      company:   contact.currentCompany,
      title:     contact.currentTitle,
      hebrewFirstName: contact.hebrewFirstName ?? null,
    };
    const { body, missing } = renderTemplate(campaign.template.body, { recipient, sender });
    const status = missing.length > 0 ? "SKIPPED" : "PENDING";
    const errorMessage = missing.length > 0 ? `missing_variable:${missing.join(",")}` : null;
    // scheduledAt stored for display; actual dispatch is immediate (Inngest throttle + Redis quota handles pacing)
    const scheduledAt = new Date(cursor);
    cursor += jitterSeconds() * 1000;

    const recipientRow = await prisma.campaignRecipient.create({
      data: { campaignId, contactId: contact.id, status, renderedBody: body || null, errorMessage, scheduledAt },
    });

    if (status === "PENDING") {
      const eventName =
        campaign.channel === "WHATSAPP"
          ? "campaign.send-whatsapp"
          : campaign.channel === "EMAIL"
          ? "campaign.send-email"
          : "campaign.send-one";
      await inngest.send({
        name: eventName as "campaign.send-one" | "campaign.send-whatsapp" | "campaign.send-email",
        data: { recipientId: recipientRow.id },
      });
    }
  }
}

export const campaignStart = inngest.createFunction(
  { id: "campaign-start", triggers: [{ event: "campaign.start" as const }] },
  campaignStartHandler
);
