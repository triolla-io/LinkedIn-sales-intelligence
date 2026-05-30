import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const alerts = await prisma.extensionAlert.findMany({
    where: { userId: ctx.user.id, resolvedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { alerts };
});
