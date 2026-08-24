import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { markedEmployers, upsertEmployers } from "@/lib/tech-radar/population";
import { buildProfilesForMarked } from "@/lib/tech-radar/build-profiles";

/**
 * Prepare ONE person who was just added to the radar, and stop.
 *
 * This is `tech-radar.run-marked` scoped to a single contact and minus the scan. Both
 * halves of that sentence matter:
 *
 * - Scoped, because resolving the whole marked cohort would research every employer on
 *   the list — a Tavily bill measured in months of quota — to onboard one person.
 * - Minus the scan, because a scan is the expensive part and it is the weekly run's
 *   decision, not a side effect of clicking "add". The person joins the next scheduled
 *   scan.
 *
 * Building the person model alone is NOT enough: buildProfilesForMarked skips anyone
 * whose employer is not an already-researched TrackedCompany, so a newly added person
 * would be silently dropped and sit in "בהכנה" forever. The employer research has to
 * happen here, and the UI's stall rule is what catches it when it doesn't.
 */

/** Research is async and paced by its own concurrency; poll rather than guess. */
const MAX_WAIT_ROUNDS = 15;
const WAIT_SECONDS = 45;

export const radarPersonPrepare = inngest.createFunction(
  {
    id: "radar-person-prepare",
    name: "Relationship Radar — prepare one added person",
    // Keyed on the contact so two people can be onboarded at once, but a double-click
    // on one person cannot run the same research twice.
    concurrency: { limit: 1, key: "event.data.contactId" },
    triggers: [{ event: "radar.person.prepare" as const }],
  },
  async ({ event, step }) => {
    const { orgId, ownerId, contactId } = event.data as {
      orgId: string;
      ownerId: string;
      contactId: string;
    };

    const employers = await step.run("resolve-employer", () =>
      markedEmployers(ownerId, [contactId])
    );
    if (employers.length === 0) {
      // No resolvable employer. The screen derives this same conclusion from the absence
      // of a TrackedCompany and tells the user, so failing quietly here is correct.
      return { contactId, employers: 0, skipped: "no_employer" };
    }

    const upsert = await step.run("upsert-employer", () => upsertEmployers(orgId, employers));

    if (upsert.pendingResearch.length > 0) {
      await step.sendEvent(
        "dispatch-research",
        upsert.pendingResearch.map((trackedCompanyId) => ({
          name: "tech-radar.company.research" as const,
          data: { trackedCompanyId },
        }))
      );
    }

    // Wait for the profile to exist. Building the person model before research lands
    // produces "no usable profile" and the person is skipped — a failure that looks
    // exactly like a person with no interests.
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

    const profiles = await step.run("build-person-profile", () =>
      buildProfilesForMarked({ orgId, ownerId, contactIds: [contactId] })
    );

    // Deliberately dispatches no scan.
    return { contactId, employers: employers.length, waitedOut: !settled, profiles };
  }
);
