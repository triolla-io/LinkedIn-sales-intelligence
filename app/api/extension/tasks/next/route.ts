import { NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/extension/with-extension-auth";
import { prisma } from "@/lib/prisma";

export const GET = withExtensionAuth(async (_req, ctx) => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "ExtensionTask"
    SET status = 'CLAIMED', "claimedAt" = NOW(), "attemptCount" = "attemptCount" + 1
    WHERE id = (
      SELECT id FROM "ExtensionTask"
      WHERE "userId" = ${ctx.user.id}
        AND status = 'PENDING'
        AND "scheduledFor" <= NOW()
      ORDER BY "scheduledFor" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  if (rows.length === 0) return new NextResponse(null, { status: 204 });
  const task = await prisma.extensionTask.findUniqueOrThrow({ where: { id: rows[0].id } });
  return NextResponse.json({
    id: task.id,
    kind: task.kind,
    payload: task.payload,
    recipientId: task.recipientId,
    attemptCount: task.attemptCount,
  });
});
