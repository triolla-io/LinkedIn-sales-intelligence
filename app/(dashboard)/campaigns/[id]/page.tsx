import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import CampaignDetailClient from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const userId = session.user.id;
  const { id } = await params;

  const sequence = await prisma.sequence.findFirst({
    where: { id, ownerId: userId },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, include: { template: { select: { name: true } } } },
      contactList: { select: { name: true } },
      enrollments: {
        include: {
          contact: { select: { fullName: true, currentTitle: true, currentCompany: true } },
          executions: {
            orderBy: { step: { stepNumber: "asc" } },
            include: { step: { select: { stepNumber: true, channel: true, dayOffset: true } } },
          },
        },
        orderBy: { enrolledAt: "asc" },
        // contactId is included by default as a scalar field on Enrollment
      },
    },
  });

  if (!sequence) notFound();

  const extensionSession = await prisma.extensionSession.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true },
  });

  const contacts = await prisma.contact.findMany({
    where: { ownerId: userId },
    select: { id: true, fullName: true, currentTitle: true, currentCompany: true },
    orderBy: { fullName: "asc" },
    take: 500,
  });

  return (
    <CampaignDetailClient
      sequence={sequence}
      extensionLastSeen={extensionSession?.lastSeenAt?.toISOString() ?? null}
      contacts={contacts}
    />
  );
}
