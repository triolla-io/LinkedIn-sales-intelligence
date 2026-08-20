import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { markedEmployers, upsertEmployers } from "@/lib/tech-radar/population";

/**
 * One person-first run, end to end, with no manual steps.
 *
 * The user marks people; everything after that is this function's job: resolve their
 * employers, research the ones we have no profile for, wait for that to land, then scan.
 * Previously the employer half was manual — you typed companies into a form — which made
 * "test these six people" impossible to express.
 *
 * Population is restricted to MARKED contacts. Running it over the automatic rule instead
 * would resolve ~2,000 people to ~1,700 employers on the pilot owner's list, and
 * researching those would burn the monthly Tavily quota several times over.
 */

/** Research is async and paced by its own concurrency; poll rather than guess a duration. */
const MAX_WAIT_ROUNDS = 15;
const WAIT_SECONDS = 45;

export const techRadarRunMarked = inngest.createFunction(
  {
    id: "tech-radar-run-marked",
    name: "Tech Radar — run for marked people",
    concurrency: 1,
    triggers: [{ event: "tech-radar.run-marked" as const }],
  },
  async ({ event, step }) => {
    const { orgId, ownerId } = event.data as { orgId: string; ownerId: string };

    const employers = await step.run("resolve-employers-of-marked", () => markedEmployers(ownerId));
    if (employers.length === 0) {
      return { employers: 0, skipped: "nobody marked" };
    }

    const upsert = await step.run("upsert-employers", () => upsertEmployers(orgId, employers));

    if (upsert.pendingResearch.length > 0) {
      await step.sendEvent(
        "dispatch-research",
        upsert.pendingResearch.map((trackedCompanyId) => ({
          name: "tech-radar.company.research" as const,
          data: { trackedCompanyId },
        }))
      );
    }

    // Wait for the profiles to exist. A scan started before research lands finds no
    // usable profile and silently produces nothing — the failure looks like "no news".
    const watching = [...upsert.pendingResearch, ...upsert.alreadyPending];
    let settled = watching.length === 0;
    for (let round = 0; round < MAX_WAIT_ROUNDS && !settled; round += 1) {
      await step.sleep(`wait-${round}`, `${WAIT_SECONDS}s`);
      settled = await step.run(`check-${round}`, async () => {
        const left = await prisma.trackedCompany.count({
          where: { id: { in: watching }, status: "PENDING_RESEARCH" },
        });
        return left === 0;
      });
    }

    await step.sendEvent("dispatch-scan", [
      { name: "tech-radar.scan" as const, data: { orgId } },
    ]);

    return {
      employers: employers.length,
      created: upsert.created,
      matched: upsert.matched,
      researched: upsert.pendingResearch.length,
      waitedOut: !settled,
      scan: 1,
    };
  }
);
