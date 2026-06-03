import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CampaignBuilder from "./campaign-builder";

export default async function NewCampaignPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const userId = session.user.id;

  const [contactLists, templates] = await Promise.all([
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

  return (
    <CampaignBuilder
      contactLists={contactLists}
      templates={templates}
    />
  );
}
