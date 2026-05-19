import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const campaigns = await prisma.campaign.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
  });
  return <CampaignsClient campaigns={campaigns} />;
}
