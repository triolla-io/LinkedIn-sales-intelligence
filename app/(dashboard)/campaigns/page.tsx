import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const [sequences, lists, templates, extensionSession] = await Promise.all([
    prisma.sequence.findMany({
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
    }),
    prisma.contactList.findMany({
      where: { ownerId: session.user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.messageTemplate.findMany({
      where: { ownerId: session.user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.extensionSession.findFirst({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true, revokedAt: true },
    }),
  ]);

  return (
    <CampaignsClient
      sequences={sequences}
      lists={lists}
      templates={templates}
      extensionLastSeen={extensionSession?.lastSeenAt?.toISOString() ?? null}
      extensionRevokedAt={extensionSession?.revokedAt?.toISOString() ?? null}
    />
  );
}
