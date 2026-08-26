import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Adding a person must prepare THAT person and spend nothing else. The two assertions
 * that carry real money: the employer resolution is scoped to the one contact (the whole
 * cohort would research ~1,700 employers), and no scan is dispatched (a scan is the
 * expensive step and belongs to the weekly run).
 */

const markedEmployers = vi.fn();
const upsertEmployers = vi.fn();
vi.mock("@/lib/tech-radar/population", () => ({
  markedEmployers: (...a: unknown[]) => markedEmployers(...a),
  upsertEmployers: (...a: unknown[]) => upsertEmployers(...a),
}));

const buildProfilesForMarked = vi.fn();
vi.mock("@/lib/tech-radar/build-profiles", () => ({
  buildProfilesForMarked: (...a: unknown[]) => buildProfilesForMarked(...a),
}));

const companyCount = vi.fn();
const contactFindUnique = vi.fn();
const extensionTaskCreate = vi.fn();
const extensionTaskFindFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    trackedCompany: { count: (...a: unknown[]) => companyCount(...a) },
    contact: { findUnique: (...a: unknown[]) => contactFindUnique(...a) },
    extensionTask: {
      create: (...a: unknown[]) => extensionTaskCreate(...a),
      findFirst: (...a: unknown[]) => extensionTaskFindFirst(...a),
    },
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) },
}));

const { radarPersonPrepare } = await import("@/inngest/functions/radar-person-prepare");
const handler = (radarPersonPrepare as unknown as { handler: (a: unknown) => Promise<unknown> })
  .handler;

const sendEvent = vi.fn();
const sleep = vi.fn(async (_id: string, _duration: string) => {});
/** The step ids the handler slept on this run, in order — how the tests tell the two
 *  round-numbered wait loops (scrape vs employer research) apart without colliding. */
function sleepIds(): string[] {
  return sleep.mock.calls.map(([id]) => id as string);
}
function run() {
  return handler({
    event: { data: { orgId: "org1", ownerId: "owner1", contactId: "ct1" } },
    step: {
      run: (_name: string, fn: () => unknown) => fn(),
      sendEvent,
      sleep,
    },
  });
}

beforeEach(() => {
  for (const m of [
    markedEmployers, upsertEmployers, buildProfilesForMarked, companyCount, sendEvent,
    contactFindUnique, extensionTaskCreate, extensionTaskFindFirst, sleep,
  ])
    m.mockReset();
  sleep.mockResolvedValue(undefined);
  markedEmployers.mockResolvedValue([{ name: "Delek US Holdings" }]);
  upsertEmployers.mockResolvedValue({ created: 1, matched: 0, pendingResearch: ["tc1"], alreadyPending: [] });
  buildProfilesForMarked.mockResolvedValue({ built: 1, axesCreated: 3 });
  companyCount.mockResolvedValue(0);
  // Default: this contact was scraped moments ago — fresh, no scrape task queued. Tests
  // that care about the stale/missing path override this explicitly.
  contactFindUnique.mockResolvedValue({
    linkedinUrl: "https://linkedin.com/in/ct1",
    profileScrapedAt: new Date(),
  });
  extensionTaskCreate.mockResolvedValue({ id: "task1" });
  // Default: nothing already queued for this contact.
  extensionTaskFindFirst.mockResolvedValue(null);
});

describe("radar.person.prepare", () => {
  it("resolves only the added contact's employer", async () => {
    await run();
    expect(markedEmployers).toHaveBeenCalledWith("owner1", ["ct1"]);
  });

  it("dispatches research for an employer we have no profile for", async () => {
    await run();
    const [, events] = sendEvent.mock.calls[0];
    expect(events).toEqual([{ name: "tech-radar.company.research", data: { trackedCompanyId: "tc1" } }]);
  });

  it("builds the person model scoped to that contact", async () => {
    await run();
    expect(buildProfilesForMarked).toHaveBeenCalledWith({
      orgId: "org1",
      ownerId: "owner1",
      contactIds: ["ct1"],
    });
  });

  it("never dispatches a scan — that costs money and is the weekly run's job", async () => {
    await run();
    const dispatched = sendEvent.mock.calls.flatMap(([, events]) =>
      (events as { name: string }[]).map((e) => e.name)
    );
    expect(dispatched).not.toContain("radar.person-scan");
    expect(dispatched).not.toContain("tech-radar.scan");
  });

  it("stops early when the contact has no resolvable employer", async () => {
    markedEmployers.mockResolvedValue([]);
    const out = (await run()) as { skipped: string };
    expect(out.skipped).toBe("no_employer");
    expect(upsertEmployers).not.toHaveBeenCalled();
    expect(buildProfilesForMarked).not.toHaveBeenCalled();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("does not queue a scrape when the profile was scraped recently", async () => {
    await run();
    expect(extensionTaskCreate).not.toHaveBeenCalled();
  });

  /**
   * A contact hand-marked from the "אנשים" tab can have no LinkedIn URL at all. Without
   * this guard, a task would be queued that the extension can never claim/act on, and
   * the poll below would burn its full MAX_WAIT_ROUNDS × WAIT_SECONDS (~11 min) before
   * falling through to buildProfilesForMarked's person_data_missing backstop anyway.
   */
  it("skips the scrape task and the wait entirely when the contact has no linkedinUrl", async () => {
    contactFindUnique.mockResolvedValue({ linkedinUrl: "", profileScrapedAt: null });
    await run();
    expect(extensionTaskCreate).not.toHaveBeenCalled();
    expect(sleepIds().filter((id) => id.startsWith("scrape-wait-"))).toHaveLength(0);
    expect(buildProfilesForMarked).toHaveBeenCalled();
  });

  it("queues a SCRAPE_PROFILE task when the profile has never been scraped", async () => {
    contactFindUnique.mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ct1", profileScrapedAt: null });
    // Poll checks after the initial fetch — keep returning null so timeout is exercised.
    contactFindUnique.mockResolvedValue({ profileScrapedAt: null });
    await run();
    expect(extensionTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "owner1",
        kind: "SCRAPE_PROFILE",
        payload: { contactId: "ct1", linkedinUrl: "https://linkedin.com/in/ct1" },
      }),
    });
  });

  it("queues a SCRAPE_PROFILE task when the last scrape is older than RADAR_SCRAPE_STALE_DAYS", async () => {
    contactFindUnique.mockResolvedValueOnce({
      linkedinUrl: "https://linkedin.com/in/ct1",
      profileScrapedAt: new Date(Date.now() - 40 * 86_400_000), // 40 days — past the 30-day window
    });
    contactFindUnique.mockResolvedValue({ profileScrapedAt: null });
    await run();
    expect(extensionTaskCreate).toHaveBeenCalled();
  });

  it("polls up to MAX_WAIT_ROUNDS and proceeds (does not fail) when the scrape never lands", async () => {
    contactFindUnique.mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ct1", profileScrapedAt: null });
    contactFindUnique.mockResolvedValue({ profileScrapedAt: null }); // never lands
    const out = (await run()) as { profileWaitedOut: boolean };
    // Distinct step-id prefix from the employer-research wait loop, so the two cannot
    // collide in Inngest's step memoisation.
    const scrapeSleeps = sleepIds().filter((id) => id.startsWith("scrape-wait-"));
    expect(scrapeSleeps).toHaveLength(15); // MAX_WAIT_ROUNDS
    expect(out.profileWaitedOut).toBe(true);
    // Proceeds anyway — the person model still gets built.
    expect(buildProfilesForMarked).toHaveBeenCalled();
  });

  it("stops polling as soon as the scrape lands, using the same wait-loop pattern as employer research", async () => {
    contactFindUnique.mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ct1", profileScrapedAt: null });
    contactFindUnique.mockResolvedValueOnce({ profileScrapedAt: null }); // round 0: not yet
    contactFindUnique.mockResolvedValue({ profileScrapedAt: new Date() }); // round 1+: landed
    const out = (await run()) as { profileWaitedOut: boolean };
    expect(out.profileWaitedOut).toBe(false);
    const scrapeSleeps = sleepIds().filter((id) => id.startsWith("scrape-wait-"));
    expect(scrapeSleeps.length).toBeLessThan(15);
  });

  /**
   * A profile visit is a scarce, human-paced budget, not an API quota — that is why the
   * nightly dispatch dedups against live PENDING/CLAIMED SCRAPE_PROFILE tasks. Adding a
   * person whom the nightly run already queued must not buy a second visit to the same
   * profile; waiting on the task already in flight gets this run the same thing it needs.
   */
  it("does not queue a second scrape when one is already in flight, and still waits for it", async () => {
    contactFindUnique.mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ct1", profileScrapedAt: null });
    contactFindUnique.mockResolvedValue({ profileScrapedAt: null }); // never lands within the wait
    extensionTaskFindFirst.mockResolvedValue({ id: "already-queued" });

    const out = (await run()) as { profileWaitedOut: boolean };

    expect(extensionTaskCreate).not.toHaveBeenCalled();
    expect(extensionTaskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "SCRAPE_PROFILE",
          status: { in: ["PENDING", "CLAIMED"] },
          payload: { path: ["contactId"], equals: "ct1" },
        }),
      })
    );
    // It waits on the in-flight task exactly as it would on one it created itself.
    expect(sleepIds().filter((id) => id.startsWith("scrape-wait-"))).toHaveLength(15);
    expect(out.profileWaitedOut).toBe(true);
  });

  it("skips the research dispatch when the employer is already researched", async () => {
    upsertEmployers.mockResolvedValue({ created: 0, matched: 1, pendingResearch: [], alreadyPending: [] });
    await run();
    expect(sendEvent).not.toHaveBeenCalled();
    expect(buildProfilesForMarked).toHaveBeenCalled();
  });
});
