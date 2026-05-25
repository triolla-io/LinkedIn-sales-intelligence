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

  const { id } = await params;

  const sequence = await prisma.sequence.findFirst({
    where: { id, ownerId: session.user.id },
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
      },
    },
  });

  if (!sequence) notFound();

  return <CampaignDetailClient sequence={sequence} />;
}
