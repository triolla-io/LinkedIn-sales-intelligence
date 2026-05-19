import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const { id } = await params;
  const campaign = await prisma.campaign.findFirst({
    where: { id, ownerId: session.user.id },
    include: {
      template: { select: { name: true } },
      recipients: {
        include: { contact: { select: { fullName: true, currentTitle: true, currentCompany: true } } },
        orderBy: { scheduledAt: "asc" },
      },
    },
  });
  if (!campaign) notFound();

  const serialized = {
    ...campaign,
    recipients: campaign.recipients.map((r) => ({
      ...r,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
    })),
  };

  return <CampaignDetailClient initial={serialized} />;
}
