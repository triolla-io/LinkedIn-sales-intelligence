import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const [user, contactCount, latestImport] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id } }),
    prisma.contact.count({ where: { ownerId: session.user.id, removedAt: null } }),
    prisma.import.findFirst({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { fileName: true, added: true, updated: true, removed: true, createdAt: true },
    }),
  ]);

  if (!user) redirect("/sign-in");

  return (
    <DashboardClient
      user={{ name: user.name, email: user.email, image: user.image }}
      contactCount={contactCount}
      latestImport={
        latestImport
          ? {
              fileName: latestImport.fileName,
              added: latestImport.added,
              updated: latestImport.updated,
              removed: latestImport.removed,
              createdAt: latestImport.createdAt.toISOString(),
            }
          : null
      }
    />
  );
}
