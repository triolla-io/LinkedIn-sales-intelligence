import { prisma } from "@/lib/prisma";

/**
 * Transition an ImportJob out of a non-terminal state to ERROR. Guarded on the
 * current status so we never clobber a job that has since reached DONE (e.g. a
 * lazily-reaped run that was actually still alive and finished). Used both by
 * staleness reaping and by user-initiated cancel.
 */
export async function markImportJobErrored(id: string, error: string): Promise<void> {
  await prisma.importJob
    .updateMany({
      where: { id, status: { in: ["QUEUED", "PROCESSING"] } },
      data: { status: "ERROR", error },
    })
    .catch(() => {});
}
