import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const [user, contactCount, latestSync] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: { linkedinSession: { select: { status: true, lastValidatedAt: true } } },
    }),
    prisma.contact.count({ where: { ownerId: session.user.id, removedAt: null } }),
    prisma.syncJob.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true, finishedAt: true, type: true },
    }),
  ]);

  if (!user) redirect("/sign-in");

  const linkedinStatus = user.linkedinSession?.status ?? "DISCONNECTED";
  const lastValidated = user.linkedinSession?.lastValidatedAt?.toISOString() ?? null;

  return (
    <DashboardClient
      user={{ name: user.name, email: user.email, image: user.image }}
      linkedinStatus={linkedinStatus}
      lastValidated={lastValidated}
      contactCount={contactCount}
      latestSync={
        latestSync
          ? {
              status: latestSync.status,
              type: latestSync.type,
              createdAt: latestSync.createdAt.toISOString(),
              finishedAt: latestSync.finishedAt?.toISOString() ?? null,
            }
          : null
      }
    />
  );
}
