import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const sequences = await prisma.sequence.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, select: { stepNumber: true, channel: true, dayOffset: true } },
      contactList: { select: { name: true } },
      _count: { select: { enrollments: true } },
      enrollments: {
        select: {
          executions: {
            where: { status: { not: "SKIPPED" } },
            select: { status: true, step: { select: { stepNumber: true } } },
          },
        },
      },
    },
  });

  const lists = await prisma.contactList.findMany({
    where: { ownerId: session.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const templates = await prisma.messageTemplate.findMany({
    where: { ownerId: session.user.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return <CampaignsClient sequences={sequences} lists={lists} templates={templates} />;
}
