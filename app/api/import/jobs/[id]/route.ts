import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { isStaleImportJob, STALE_IMPORT_ERROR } from "@/lib/import/stale";
import { markImportJobErrored } from "@/lib/import/reap";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return withTenant(async (_req, ctx) => {
    const job = await prisma.importJob.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      select: {
        id: true,
        status: true,
        stage: true,
        total: true,
        processed: true,
        error: true,
        fileName: true,
        updatedAt: true,
        added: true,
        updated: true,
        removed: true,
        unchanged: true,
        companies: true,
        newCompanies: true,
      },
    });
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Lazily reap a job whose owning Inngest run is clearly dead so the poller
    // stops spinning and surfaces an actionable error instead of hanging forever.
    if (isStaleImportJob(job, Date.now())) {
      await markImportJobErrored(job.id, STALE_IMPORT_ERROR);
      return NextResponse.json({ ...job, status: "ERROR", error: STALE_IMPORT_ERROR });
    }

    return NextResponse.json(job);
  })(req);
}

/**
 * DELETE /api/import/jobs/[id]
 * User-initiated cancel of an in-flight import. Frees `/api/import/active` so the
 * user can re-upload. The Inngest run is not force-killed; if it is still alive
 * it may still finish and self-correct the job to DONE — harmless.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return withTenant(async (_req, ctx) => {
    const job = await prisma.importJob.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
      select: { id: true },
    });
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await markImportJobErrored(job.id, "בוטל על ידי המשתמש");
    return NextResponse.json({ ok: true });
  })(req);
}
