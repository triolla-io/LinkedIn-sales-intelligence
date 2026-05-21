import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import SequencesClient from "@/components/dashboard/sequences-client";

export default async function SequencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const sequences = await prisma.sequence.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { stepNumber: "asc" }, select: { stepNumber: true, channel: true, dayOffset: true } },
      contactList: { select: { name: true } },
      _count: { select: { enrollments: true } },
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
    select: { id: true, name: true, body: true },
  });

  return <SequencesClient sequences={sequences} lists={lists} templates={templates} />;
}
