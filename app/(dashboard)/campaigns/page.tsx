import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { waClient } from "@/lib/whatsapp/client";
import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const [sequences, extensionSession, whatsappStatus] = await Promise.all([
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
    prisma.extensionSession.findFirst({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { lastSeenAt: "desc" },
      select: { lastSeenAt: true, revokedAt: true },
    }),
    waClient.status(session.user.id),
  ]);

  return (
    <CampaignsClient
      sequences={sequences}
      extensionLastSeen={extensionSession?.lastSeenAt?.toISOString() ?? null}
      extensionRevokedAt={extensionSession?.revokedAt?.toISOString() ?? null}
      whatsappStatus={whatsappStatus.status}
    />
  );
}
