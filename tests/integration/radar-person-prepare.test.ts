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
vi.mock("@/lib/prisma", () => ({
  prisma: { trackedCompany: { count: (...a: unknown[]) => companyCount(...a) } },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) },
}));

const { radarPersonPrepare } = await import("@/inngest/functions/radar-person-prepare");
const handler = (radarPersonPrepare as unknown as { handler: (a: unknown) => Promise<unknown> })
  .handler;

const sendEvent = vi.fn();
function run() {
  return handler({
    event: { data: { orgId: "org1", ownerId: "owner1", contactId: "ct1" } },
    step: {
      run: (_name: string, fn: () => unknown) => fn(),
      sendEvent,
      sleep: async () => {},
    },
  });
}

beforeEach(() => {
  for (const m of [markedEmployers, upsertEmployers, buildProfilesForMarked, companyCount, sendEvent])
    m.mockReset();
  markedEmployers.mockResolvedValue([{ name: "Delek US Holdings" }]);
  upsertEmployers.mockResolvedValue({ created: 1, matched: 0, pendingResearch: ["tc1"], alreadyPending: [] });
  buildProfilesForMarked.mockResolvedValue({ built: 1, axesCreated: 3 });
  companyCount.mockResolvedValue(0);
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

  it("skips the research dispatch when the employer is already researched", async () => {
    upsertEmployers.mockResolvedValue({ created: 0, matched: 1, pendingResearch: [], alreadyPending: [] });
    await run();
    expect(sendEvent).not.toHaveBeenCalled();
    expect(buildProfilesForMarked).toHaveBeenCalled();
  });
});
