/**
 * Staleness detection for ImportJob recovery.
 *
 * An Inngest run can die without cleanly exhausting retries — a mid-import
 * container restart/redeploy, an OOM, or a lost run. When that happens the
 * `onFailure` handler never fires, so the ImportJob is left in QUEUED/PROCESSING
 * forever: the upload page polls it indefinitely (spinner never stops) and
 * `/api/import/active` keeps re-attaching to it, blocking re-upload.
 *
 * These thresholds let the read endpoints lazily reap a job whose owning run is
 * clearly dead. They are deliberately conservative so we never reap a job that
 * is genuinely still running — `updatedAt` only advances per upsert batch and at
 * stage transitions, and the `companies` stage can run silently for minutes on a
 * large import. If we ever reap a job that is actually still alive, the Inngest
 * `finalize` step's unconditional update to DONE self-corrects it.
 */

// Inngest pickup is near-instant; a QUEUED job untouched this long was never picked up.
export const QUEUED_STALE_MS = 5 * 60 * 1000; // 5 minutes

// A PROCESSING job's updatedAt can sit still through the long, silent companies stage.
export const PROCESSING_STALE_MS = 20 * 60 * 1000; // 20 minutes

export function isStaleImportJob(
  job: { status: string; updatedAt: Date },
  now: number,
): boolean {
  const age = now - job.updatedAt.getTime();
  if (job.status === "QUEUED") return age > QUEUED_STALE_MS;
  if (job.status === "PROCESSING") return age > PROCESSING_STALE_MS;
  return false;
}

export const STALE_IMPORT_ERROR =
  "הייבוא נתקע ולא הסתיים. ניתן להעלות את הקובץ מחדש.";
