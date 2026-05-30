import { withExtensionAuth } from "@/lib/extension/with-extension-auth";

export const POST = withExtensionAuth(async (_req, ctx) => {
  return { ok: true, userId: ctx.user.id, email: ctx.user.email };
});
