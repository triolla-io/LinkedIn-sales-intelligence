import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { markedEmployers, upsertEmployers } from "@/lib/tech-radar/population";
import { buildProfilesForMarked } from "@/lib/tech-radar/build-profiles";
import { RADAR_SCRAPE_STALE_DAYS } from "@/lib/job-check/dispatch";

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
 *
 * The person model also needs the person themselves: buildProfilesForMarked now refuses
 * to model a contact with no currentTitle, no headline and no about paragraph
 * (`person_data_missing`). Someone hand-added from the "אנשים" tab may never have been
 * through a SCRAPE_PROFILE pass, so this queues one — through the OWNER's own extension
 * session, no Apollo/Bright Data spend — and waits for it before building the model,
 * the same way it waits for employer research. If the nightly dispatch already has one
 * queued for this contact it waits on that instead of paying for a second profile visit.
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

    // Queue a fresh SCRAPE_PROFILE if this contact's data is missing or older than the
    // radar's staleness clock (RADAR_SCRAPE_STALE_DAYS — the same one job-check dispatch
    // uses for its own radar-marked source). Returns the epoch ms the task was requested
    // at, so the poll below can tell "the scrape that already sat there stale" apart from
    // "the fresh one this run asked for" — both look like a non-null profileScrapedAt.
    const scrapeRequest = await step.run("refresh-profile-scrape", async () => {
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { linkedinUrl: true, profileScrapedAt: true },
      });
      if (!contact) return { needsScrape: false, requestedAt: 0 };
      // No LinkedIn URL — same gate dispatch.ts's own radar query applies
      // (`linkedinUrl: { not: "" }`). Without it, a task would be queued that the
      // extension can never act on, and the wait loop below would burn its full
      // MAX_WAIT_ROUNDS × WAIT_SECONDS (~11 min) before buildProfilesForMarked's
      // person_data_missing skip ever got a chance to say why. Skip straight there.
      if (!contact.linkedinUrl) return { needsScrape: false, requestedAt: 0 };
      const staleBefore = Date.now() - RADAR_SCRAPE_STALE_DAYS * 86_400_000;
      const stale = !contact.profileScrapedAt || contact.profileScrapedAt.getTime() < staleBefore;
      if (!stale) return { needsScrape: false, requestedAt: 0 };

      const requestedAt = Date.now();
      // The nightly dispatch (lib/job-check/dispatch.ts) may already have this contact
      // queued — it dedups against live PENDING/CLAIMED tasks for exactly this reason. A
      // profile visit is a scarce, human-paced budget, not an API quota, so a second
      // visit to the same profile is a real cost for nothing. Wait on the one in flight
      // instead: it stamps profileScrapedAt when it lands, which is the only thing the
      // poll below is watching for.
      const inFlight = await prisma.extensionTask.findFirst({
        where: {
          kind: "SCRAPE_PROFILE",
          status: { in: ["PENDING", "CLAIMED"] },
          payload: { path: ["contactId"], equals: contactId },
        },
        select: { id: true },
      });
      if (!inFlight) {
        await prisma.extensionTask.create({
          data: {
            userId: ownerId,
            kind: "SCRAPE_PROFILE",
            payload: { contactId, linkedinUrl: contact.linkedinUrl },
            scheduledFor: new Date(requestedAt),
          },
        });
      }
      return { needsScrape: true, requestedAt };
    });

    // Distinct "scrape-" step-id prefix from the employer-research wait loop below —
    // both loops are round-numbered, and Inngest memoises steps by id, so reusing
    // "wait-0"/"check-0" in both would collide.
    let scraped = !scrapeRequest.needsScrape;
    for (let round = 0; round < MAX_WAIT_ROUNDS && !scraped; round += 1) {
      await step.sleep(`scrape-wait-${round}`, `${WAIT_SECONDS}s`);
      scraped = await step.run(`scrape-check-${round}`, async () => {
        const c = await prisma.contact.findUnique({
          where: { id: contactId },
          select: { profileScrapedAt: true },
        });
        return !!c?.profileScrapedAt && c.profileScrapedAt.getTime() >= scrapeRequest.requestedAt;
      });
    }
    // On timeout, proceed rather than fail — same posture as the employer-research wait
    // below. buildProfilesForMarked's person_data_missing gate is the backstop if the
    // scrape never lands at all.

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
    return {
      contactId,
      employers: employers.length,
      profileWaitedOut: scrapeRequest.needsScrape && !scraped,
      waitedOut: !settled,
      profiles,
    };
  }
);
