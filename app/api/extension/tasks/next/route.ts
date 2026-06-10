import { NextResponse } from "next/server";
import { withExtensionAuth } from "@/lib/extension/with-extension-auth";
import { prisma } from "@/lib/prisma";

// A task is CLAIMED the moment the extension polls it. If the extension crashes or
// hangs mid-task (e.g. a tab never loads), it never reports a result and the task is
// stranded in CLAIMED forever. Re-claim such tasks after this long so a hang self-heals
// instead of blocking the run. Real tasks finish in seconds, so 10 min is a safe floor.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Cap reclaims so a task that hangs every single time can't loop indefinitely.
const MAX_ATTEMPTS = 6;

export const GET = withExtensionAuth(async (_req, ctx) => {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "ExtensionTask"
    SET status = 'CLAIMED', "claimedAt" = NOW(), "attemptCount" = "attemptCount" + 1
    WHERE id = (
      SELECT id FROM "ExtensionTask"
      WHERE "userId" = ${ctx.user.id}
        AND "scheduledFor" <= NOW()
        AND (
          status = 'PENDING'
          OR (status = 'CLAIMED' AND "claimedAt" < ${staleBefore} AND "attemptCount" < ${MAX_ATTEMPTS})
        )
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
