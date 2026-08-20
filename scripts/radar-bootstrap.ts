/**
 * Gate 2 of the staged ascent: build the cohort and get its employers researched.
 *
 * Dry run (default): reads the cohort and prints counts. Writes nothing to the
 * database and makes no network call — free to re-run as often as you like.
 *
 * --dispatch: writes TrackedCompany rows for every employer AND fires one
 * `tech-radar.company.research` event per NEW or previously-failed employer. Each
 * dispatched company costs roughly one news search plus one OpenRouter profile
 * call — real spend against the $2/day OpenRouter cap. For the pilot owner that
 * is ~434 employers in one run; use --limit=N to cap it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/radar-bootstrap.ts --owner=<userId>
 *   npx tsx --env-file=.env scripts/radar-bootstrap.ts --owner=<userId> --dispatch [--limit=N]
 *
 * Without --dispatch it is a dry run: it reports what it would do and writes
 * nothing. That default is deliberate — the first thing you want from this
 * script is the cohort count, not a mutation. --limit only affects --dispatch;
 * the dry run always reports the full cohort regardless of --limit.
 */
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { summarizeCohort, upsertEmployers } from "@/lib/tech-radar/population";
import { MIN_STAFF, MAX_STAFF } from "@/lib/tech-radar/cohort";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const ownerId = arg("owner");
  const dispatch = process.argv.includes("--dispatch");

  const limitArg = arg("limit");
  let limit: number | undefined;
  if (limitArg !== undefined) {
    limit = Number(limitArg);
    if (!Number.isInteger(limit) || limit <= 0) {
      console.error(`Invalid --limit=${limitArg}. Must be a positive integer.`);
      process.exit(1);
    }
  }

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

  const { counts, employers, noEmployer } = await summarizeCohort(owner.id);

  console.log(`\nOwner: ${owner.email}  (org ${owner.orgId})`);
  console.log(`Mode:  ${dispatch ? "DISPATCH — will write and enqueue research" : "DRY RUN — writes nothing"}\n`);
  console.log("Cohort");
  console.log(`  in  · cohort (C-level, ${MIN_STAFF}-${MAX_STAFF})   ${counts.cohort}`);
  console.log(`  in  · manual opt-in              ${counts.opt_in}`);
  console.log(`  out · manual opt-out             ${counts.opt_out}`);
  console.log(`  out · not C-level                ${counts.not_clevel}`);
  console.log(`  out · headcount unknown          ${counts.size_unknown}   <-- fixable, see below`);
  console.log(`  out · headcount outside ${MIN_STAFF}-${MAX_STAFF}   ${counts.size_out_of_range}`);
  console.log(`  ----------------------------------------`);
  console.log(`  total contacts considered        ${counts.total}`);
  console.log(`\nDistinct employers of the cohort:  ${employers.length}`);
  if (noEmployer > 0) {
    console.log(
      `${noEmployer} cohort contacts have no usable employer name and are NOT among those\n` +
        `employers — they will never be researched until their employer name is fixed.`
    );
  }

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

  let toProcess = employers;
  if (limit !== undefined && employers.length > limit) {
    console.log(
      `\n--limit=${limit}: processing the first ${limit} of ${employers.length} employers this run; ` +
        `${employers.length - limit} left for a future run.`
    );
    toProcess = employers.slice(0, limit);
  }

  const { created, matched, pendingResearch, alreadyPending } = await upsertEmployers(owner.orgId, toProcess);
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
    if (alreadyPending.length > 0) {
      console.log(
        "No employer needs a new dispatch: every one of them either has a researched profile\n" +
          "already, or has research in flight from an earlier run. Nothing to dispatch.\n"
      );
    } else {
      console.log("Every employer already has a researched profile. Nothing to dispatch.\n");
    }
    return;
  }

  // Announce the spend before firing it: this dispatch is the one part of the pipeline
  // that actually costs money (Apollo/Bright Data are not involved here — this is
  // OpenRouter). Research is per company and idempotent on the receiving side.
  console.log(
    `\nAbout to research ${pendingResearch.length} compan${pendingResearch.length === 1 ? "y" : "ies"} ` +
      `(~1 news search + 1 OpenRouter profile call each) — real spend against the OpenRouter $2/day cap.\n`
  );

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
