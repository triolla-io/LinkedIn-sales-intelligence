import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CampaignBuilder from "../../new/campaign-builder";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const { id } = await params;
  const userId = session.user.id;

  const [sequence, contactLists, templates] = await Promise.all([
    prisma.sequence.findFirst({
      where: { id, ownerId: userId },
      include: { steps: { orderBy: { stepNumber: "asc" } } },
    }),
    prisma.contactList.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.messageTemplate.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!sequence) notFound();

  const isActive = !["DRAFT", "QUEUED"].includes(sequence.status);

  const initialSteps = sequence.steps.map((s, i) => ({
    localId: i + 1,
    stepNumber: s.stepNumber,
    channel: s.channel as "EMAIL" | "WHATSAPP" | "LINKEDIN",
    templateId: s.templateId,
    dayOffset: s.dayOffset,
    sendHour: s.sendHour,
    sendHourEnd: s.sendHourEnd ?? null,
    subject: s.subject ?? "",
  }));

  return (
    <CampaignBuilder
      contactLists={contactLists}
      templates={templates}
      initialName={sequence.name}
      initialContactListId={sequence.contactListId}
      initialSteps={initialSteps}
      sequenceId={sequence.id}
      isActive={isActive}
    />
  );
}
