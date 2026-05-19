import { prisma } from "@/lib/prisma";
import type { TenantCtx } from "@/lib/tenancy/with-tenant";

export async function recordAudit(
  ctx: TenantCtx,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId: ctx.user.id,
      targetUserId: ctx.impersonatedUserId,
      action,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: payload as any,
    },
  });
}
