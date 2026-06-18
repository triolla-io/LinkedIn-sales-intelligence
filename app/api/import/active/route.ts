import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { isStaleImportJob, STALE_IMPORT_ERROR } from "@/lib/import/stale";
import { markImportJobErrored } from "@/lib/import/reap";

export const GET = withTenant(async (_req, ctx) => {
  const job = await prisma.importJob.findFirst({
    where: {
      ownerId: ctx.effectiveUserId,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      stage: true,
      total: true,
      processed: true,
      fileName: true,
      updatedAt: true,
    },
  });

  // Lazily reap a job whose owning Inngest run is clearly dead so it stops
  // blocking re-upload. Reaped → no active job.
  if (job && isStaleImportJob(job, Date.now())) {
    await markImportJobErrored(job.id, STALE_IMPORT_ERROR);
    return NextResponse.json({ job: null });
  }

  return NextResponse.json({ job });
});
