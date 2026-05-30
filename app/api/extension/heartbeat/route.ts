import { withExtensionAuth } from "@/lib/extension/with-extension-auth";
import { prisma } from "@/lib/prisma";

export const POST = withExtensionAuth(async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as { version?: string };
  await prisma.extensionSession.update({
    where: { id: ctx.sessionId },
    data: { lastSeenAt: new Date(), version: body.version ?? undefined },
  });
  await prisma.extensionAlert.updateMany({
    where: { userId: ctx.user.id, kind: "OFFLINE", resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  return { ok: true };
});
