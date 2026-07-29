/**
 * Return burned FAILED company targets to PENDING so discovery retries them.
 *
 * Background: on 2026-07-26 a LinkedIn search rate-limit wave + a zero-delay
 * failure path burned 748 companies (`no_id`) in 95 minutes. Those are false
 * negatives — the companies exist. After the pacing fix + circuit breaker,
 * this script re-queues them; the run resumes at the healthy 2–5 min cadence
 * inside its send window (via prospecting-tick), one company at a time.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/retry-failed-companies.ts <runId> [--since 2026-07-26] [--errors no_id,not_found] [--apply]
 *
 * Dry-run by default — pass --apply to write.
 * Safe to run multiple times (only touches status=FAILED rows).
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const runId = process.argv[2];
  if (!runId || runId.startsWith("--")) {
    console.error("Usage: npx tsx --env-file=.env scripts/retry-failed-companies.ts <runId> [--since YYYY-MM-DD] [--errors no_id,not_found] [--apply]");
    process.exit(1);
  }
  const since = arg("--since") ? new Date(`${arg("--since")}T00:00:00Z`) : undefined;
  const errors = (arg("--errors") ?? "no_id,not_found,search_failed,resolve_failed").split(",").map((e) => e.trim());
  const apply = process.argv.includes("--apply");

  const run = await prisma.prospectingRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.error(`Run ${runId} not found`);
    process.exit(1);
  }

  const where = {
    runId,
    status: "FAILED" as const,
    error: { in: errors },
    ...(since ? { updatedAt: { gte: since } } : {}),
  };

  const byError = await prisma.prospectingCompanyTarget.groupBy({
    by: ["error"],
    where,
    _count: true,
  });
  const total = byError.reduce((s, g) => s + g._count, 0);
  console.log(`Run: ${run.name} (${run.status})`);
  console.log(`Matched FAILED targets:${since ? ` (since ${since.toISOString().slice(0, 10)})` : ""}`);
  for (const g of byError) console.log(`  ${g.error}: ${g._count}`);
  console.log(`  total: ${total}`);

  if (!apply) {
    console.log("\nDry run — nothing changed. Re-run with --apply to reset these to PENDING.");
    return;
  }

  const updated = await prisma.prospectingCompanyTarget.updateMany({
    where,
    data: { status: "PENDING", error: null },
  });
  // The burn ended with discoveryDone=true (queue looked exhausted) — the tick
  // only starts PENDING companies while discoveryDone is false, so flip it back.
  if (updated.count > 0) {
    await prisma.prospectingRun.updateMany({
      where: { id: runId },
      data: { discoveryDone: false },
    });
  }
  console.log(`\nReset ${updated.count} companies to PENDING (and discoveryDone=false).`);
  console.log("The 5-min prospecting-tick will resume them one at a time (2–5 min apart, inside the send window).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
