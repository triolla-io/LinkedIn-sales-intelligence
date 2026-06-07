/**
 * Backfill missing SequenceStepExecution rows for active enrollments.
 *
 * Background: before the windowed-pre-scheduling refactor, only the first
 * step's execution was created at enrollment time; subsequent steps were
 * created one-by-one as each step completed (maybeAdvance). The new code
 * pre-creates ALL step executions at enrollment. Any enrollment that was
 * created under the old model is missing executions for steps 2, 3, etc.
 *
 * This script finds every ACTIVE enrollment whose sequence has more steps
 * than the enrollment has executions, and creates the missing rows — but
 * ONLY for steps that haven't already been covered (skips already-terminal
 * steps to avoid re-sending them).
 *
 * Safe to run multiple times (skipDuplicates + @@unique([enrollmentId, stepId])).
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/backfill-missing-step-executions.ts
 */

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";
import { buildEnrollmentExecutions } from "../lib/sequences/helpers";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // Load all ACTIVE enrollments whose sequence has steps
  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { status: "ACTIVE" },
    include: {
      sequence: {
        include: {
          steps: {
            orderBy: { stepNumber: "asc" },
            select: { id: true, dayOffset: true, sendHour: true, sendMinute: true, sendHourEnd: true },
          },
        },
      },
      executions: {
        select: { stepId: true, status: true },
      },
    },
  });

  console.log(`Found ${enrollments.length} ACTIVE enrollments`);

  let totalCreated = 0;
  let skippedEnrollments = 0;

  for (const enr of enrollments) {
    const allSteps = enr.sequence.steps;
    if (allSteps.length === 0) continue;

    // Steps that already have an execution (any status)
    const coveredStepIds = new Set(enr.executions.map((e: { stepId: string }) => e.stepId));

    // Steps that need a new execution — exclude already covered ones
    const missingSteps = allSteps.filter((s: typeof allSteps[number]) => !coveredStepIds.has(s.id));

    if (missingSteps.length === 0) {
      skippedEnrollments++;
      continue;
    }

    // Build spaced execution rows for the missing steps only.
    // We use buildEnrollmentExecutions on ALL steps to keep the spacing
    // consistent, then filter to only insert the missing ones.
    const allRows = buildEnrollmentExecutions(enr.enrolledAt, allSteps);
    const missingStepIds = new Set(missingSteps.map((s: typeof allSteps[number]) => s.id));
    const rowsToInsert = allRows.filter((row) => missingStepIds.has(row.stepId));

    const { count } = await prisma.sequenceStepExecution.createMany({
      data: rowsToInsert.map((row) => ({ ...row, enrollmentId: enr.id })),
      skipDuplicates: true,
    });

    if (count > 0) {
      console.log(
        `  enrollment ${enr.id} (sequence: ${enr.sequence.id}): created ${count} missing execution(s) for steps ${missingSteps.map((s: typeof allSteps[number]) => s.id).join(", ")}`
      );
      totalCreated += count;
    }
  }

  console.log(`\nDone. Created ${totalCreated} execution(s) across ${enrollments.length - skippedEnrollments} enrollment(s). ${skippedEnrollments} already fully covered.`);
}

main().catch(console.error).finally(() => pool.end());
