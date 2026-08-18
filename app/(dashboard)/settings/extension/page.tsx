import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServedExtensionVersion } from "@/lib/extension/built-version";
import { ExtensionClient } from "./extension-client";

export default async function ExtensionSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const data = await prisma.extensionSession.findUnique({
    where: { userId: session.user.id },
    select: { id: true, tokenPrefix: true, lastSeenAt: true, version: true, revokedAt: true, createdAt: true },
  });
  return (
    <ExtensionClient
      servedVersion={getServedExtensionVersion()}
      initialSession={
        data
          ? {
              id: data.id,
              tokenPrefix: data.tokenPrefix,
              lastSeenAt: data.lastSeenAt ? data.lastSeenAt.toISOString() : null,
              version: data.version,
              revokedAt: data.revokedAt ? data.revokedAt.toISOString() : null,
              createdAt: data.createdAt.toISOString(),
            }
          : null
      }
    />
  );
}
