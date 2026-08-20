/**
 * Gate 2 of the staged ascent: build the cohort and get its employers researched.
 *
 * Runs NOTHING that costs LLM tokens and dispatches NO scan. Its only outputs
 * are TrackedCompany rows and research events. Read the printed table, then look
 * at the screen (gate 3) before going any further.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/radar-bootstrap.ts --owner=<userId>
 *   npx tsx --env-file=.env scripts/radar-bootstrap.ts --owner=<userId> --dispatch
 *
 * Without --dispatch it is a dry run: it reports what it would do and writes
 * nothing. That default is deliberate — the first thing you want from this
 * script is the cohort count, not a mutation.
 */
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { summarizeCohort, upsertEmployers } from "@/lib/tech-radar/population";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const ownerId = arg("owner");
  const dispatch = process.argv.includes("--dispatch");

  if (!ownerId) {
    console.error("Missing --owner=<userId>. Find it with: npx prisma studio");
    process.exit(1);
  }

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true, orgId: true },
  });
  if (!owner) {
    console.error(`No user with id ${ownerId}`);
    process.exit(1);
  }

  const { counts, employers } = await summarizeCohort(owner.id);

  console.log(`\nOwner: ${owner.email}  (org ${owner.orgId})`);
  console.log(`Mode:  ${dispatch ? "DISPATCH — will write and enqueue research" : "DRY RUN — writes nothing"}\n`);
  console.log("Cohort");
  console.log(`  in  · cohort (C-level, 50-200)   ${counts.cohort}`);
  console.log(`  in  · manual opt-in              ${counts.opt_in}`);
  console.log(`  out · manual opt-out             ${counts.opt_out}`);
  console.log(`  out · not C-level                ${counts.not_clevel}`);
  console.log(`  out · headcount unknown          ${counts.size_unknown}   <-- fixable, see below`);
  console.log(`  out · headcount outside 50-200   ${counts.size_out_of_range}`);
  console.log(`  ----------------------------------------`);
  console.log(`  total contacts considered        ${counts.total}`);
  console.log(`\nDistinct employers of the cohort:  ${employers.length}`);

  if (counts.size_unknown > 0) {
    console.log(
      `\n${counts.size_unknown} C-level contacts are excluded only because we have no headcount.\n` +
        `They are NOT rejected. Enrich their companies (companies.enrich, Voyager, free)\n` +
        `and re-run this script — the cohort will grow.`
    );
  }

  if (!dispatch) {
    console.log("\nDry run complete. Re-run with --dispatch to write.\n");
    return;
  }

  const { created, matched, pendingResearch, alreadyPending } = await upsertEmployers(owner.orgId, employers);
  console.log(`\nTrackedCompany: ${created} created, ${matched} matched existing.`);

  if (alreadyPending.length > 0) {
    console.log(
      `\n${alreadyPending.length} companies are already PENDING_RESEARCH from an earlier run and were\n` +
        `NOT re-dispatched — re-dispatching in-flight research would pay for it twice. If this number\n` +
        `does not fall on the next run, their original dispatch never landed; reset those rows to\n` +
        `RESEARCH_FAILED to have this script pick them up.`
    );
  }

  if (pendingResearch.length === 0) {
    console.log("Every employer already has a researched profile. Nothing to dispatch.\n");
    return;
  }

  // Research is per company and idempotent on the receiving side.
  await inngest.send(
    pendingResearch.map((trackedCompanyId) => ({
      name: "tech-radar.company.research" as const,
      data: { trackedCompanyId },
    }))
  );
  console.log(`Dispatched research for ${pendingResearch.length} companies.`);
  console.log("No scan was dispatched. That is gate 5, and it is manual.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
