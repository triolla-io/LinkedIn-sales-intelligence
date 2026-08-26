import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindMany = vi.fn();
const mockExtensionTaskUpdateMany = vi.fn();
const mockExtensionTaskFindMany = vi.fn();
const mockExtensionTaskCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: (...a: unknown[]) => mockContactFindMany(...a) },
    extensionTask: {
      updateMany: (...a: unknown[]) => mockExtensionTaskUpdateMany(...a),
      findMany: (...a: unknown[]) => mockExtensionTaskFindMany(...a),
      createMany: (...a: unknown[]) => mockExtensionTaskCreateMany(...a),
    },
  },
}));

const contactRow = (id: string, ownerId = "o1") => ({
  id,
  ownerId,
  linkedinUrl: `https://linkedin.com/in/${id}`,
  lastJobCheckAt: null,
});

/** The contact ids of the tasks the dispatch actually created, in creation order. */
const createdIds = (): string[] =>
  (mockExtensionTaskCreateMany.mock.calls[0][0].data as { payload: { contactId: string } }[]).map(
    (d) => d.payload.contactId
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockExtensionTaskUpdateMany.mockResolvedValue({ count: 0 });
  mockExtensionTaskFindMany.mockResolvedValue([]);
  mockExtensionTaskCreateMany.mockResolvedValue({ count: 0 });
});

describe("dispatchJobChecks backlog expiry", () => {
  /**
   * Both blocking statuses, not just PENDING. The dedup below excludes a contact that
   * has a PENDING *or* CLAIMED task, and a CLAIMED task only ever leaves that state when
   * the extension POSTs a result — which a browser closed mid-scrape never does, and
   * tasks/next stops re-claiming after MAX_ATTEMPTS. Sweeping only PENDING would leave
   * exactly the corpse this sweep exists to bury.
   */
  it("cancels PENDING *and* CLAIMED SCRAPE_PROFILE tasks older than PENDING_EXPIRY_DAYS before deduping", async () => {
    mockContactFindMany.mockResolvedValue([]);
    const { dispatchJobChecks, PENDING_EXPIRY_DAYS } = await import("@/lib/job-check/dispatch");

    const before = Date.now();
    await dispatchJobChecks();

    expect(mockExtensionTaskUpdateMany).toHaveBeenCalledWith({
      where: {
        kind: "SCRAPE_PROFILE",
        status: { in: ["PENDING", "CLAIMED"] },
        createdAt: { lt: expect.any(Date) },
      },
      data: { status: "CANCELLED", errorCode: "expired_unclaimed" },
    });

    const call = mockExtensionTaskUpdateMany.mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;
    const expectedMs = PENDING_EXPIRY_DAYS * 86_400_000;
    // The cutoff should sit ~PENDING_EXPIRY_DAYS ago, measured against the same
    // dispatch call — allow a small window for test execution time.
    expect(before - cutoff.getTime()).toBeGreaterThan(expectedMs - 5_000);
    expect(before - cutoff.getTime()).toBeLessThan(expectedMs + 5_000);
  });

  it("dedups against CLAIMED tasks too, not only PENDING", async () => {
    mockContactFindMany.mockResolvedValue([contactRow("c1")]);
    // c1 already has a CLAIMED task queued — must not be re-created.
    mockExtensionTaskFindMany.mockResolvedValue([{ payload: { contactId: "c1" } }]);

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(mockExtensionTaskFindMany).toHaveBeenCalledWith({
      where: { kind: "SCRAPE_PROFILE", status: { in: ["PENDING", "CLAIMED"] } },
      select: { payload: true },
    });
    expect(mockExtensionTaskCreateMany).not.toHaveBeenCalled();
    expect(created).toBe(0);
  });
});

describe("dispatchJobChecks radar source", () => {
  const radarRow = (id: string, ownerId = "o1", profileScrapedAt: Date | null = null) => ({
    id,
    ownerId,
    linkedinUrl: `https://linkedin.com/in/${id}`,
    profileScrapedAt,
  });

  it("scrapes a radarInclude contact even when its org has jobCheckEnabled: false", async () => {
    // Same mock serves both findMany calls — branch on the where clause's shape, exactly
    // like a real WHERE would branch: the job-check source filters by jobCheckEnabled,
    // the radar source doesn't know that field exists.
    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? [radarRow("r1")] : [])
    );

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(created).toBe(1);
    expect(mockExtensionTaskCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "o1",
          kind: "SCRAPE_PROFILE",
          payload: { contactId: "r1", linkedinUrl: "https://linkedin.com/in/r1" },
        }),
      ],
    });
  });

  it("queries the radar source on radarInclude alone, with a RADAR_SCRAPE_STALE_DAYS window, not jobCheckEnabled", async () => {
    mockContactFindMany.mockResolvedValue([]);
    const { dispatchJobChecks, RADAR_SCRAPE_STALE_DAYS } = await import("@/lib/job-check/dispatch");

    const before = Date.now();
    await dispatchJobChecks();

    const radarCall = mockContactFindMany.mock.calls.find(
      (c) => (c[0] as { where: { radarInclude?: boolean } }).where.radarInclude === true
    );
    expect(radarCall).toBeTruthy();
    const where = radarCall![0].where as {
      radarInclude: boolean;
      OR: [{ profileScrapedAt: null }, { profileScrapedAt: { lt: Date } }];
    };
    expect(where.OR).toEqual([{ profileScrapedAt: null }, { profileScrapedAt: { lt: expect.any(Date) } }]);
    // Not gated on the job-check module — the scrape is free (customer's own extension).
    expect(JSON.stringify(where)).not.toContain("jobCheckEnabled");

    const cutoff = where.OR[1].profileScrapedAt.lt as unknown as Date;
    const expectedMs = RADAR_SCRAPE_STALE_DAYS * 86_400_000;
    expect(before - cutoff.getTime()).toBeGreaterThan(expectedMs - 5_000);
    expect(before - cutoff.getTime()).toBeLessThan(expectedMs + 5_000);
  });

  /**
   * Driven through a mock that EVALUATES the where clause the code builds, rather than
   * one that answers []. Answering [] would pass against an implementation with the
   * staleness gate torn out — it supplies its own conclusion. Here the row is real and
   * only the OR clause can exclude it, so dropping the gate turns 0 into 1.
   */
  function honourStaleness(rows: ReturnType<typeof radarRow>[]) {
    return (args: { where: Record<string, unknown> }) => {
      if (!args.where.radarInclude) return Promise.resolve([]);
      const or = args.where.OR as
        | Array<{ profileScrapedAt: null | { lt: Date } }>
        | undefined;
      if (!or) return Promise.resolve(rows); // gate dropped — Postgres would return everything
      return Promise.resolve(
        rows.filter((r) =>
          or.some((clause) =>
            clause.profileScrapedAt === null
              ? r.profileScrapedAt === null
              : r.profileScrapedAt !== null && r.profileScrapedAt < clause.profileScrapedAt.lt
          )
        )
      );
    };
  }

  it("a radar contact scraped 10 days ago does not get a fresh task — the staleness clause is what excludes it", async () => {
    const fresh = radarRow("r1", "o1", new Date(Date.now() - 10 * 86_400_000));
    mockContactFindMany.mockImplementation(honourStaleness([fresh]));

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    expect(await dispatchJobChecks()).toBe(0);
    expect(mockExtensionTaskCreateMany).not.toHaveBeenCalled();
  });

  it("...while a contact scraped 40 days ago DOES, through the very same harness", async () => {
    const stale = radarRow("r1", "o1", new Date(Date.now() - 40 * 86_400_000));
    mockContactFindMany.mockImplementation(honourStaleness([stale]));

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    expect(await dispatchJobChecks()).toBe(1);
  });

  /**
   * The requirement that actually matters: the radar source must NOT add to the visit
   * budget. One owner with 20 due job-check contacts AND 20 stale radar contacts (one
   * overlapping id, due on both counts) must yield exactly DAILY_CAP (25) tasks, not 40
   * and not 39 — the two sources share one per-owner cap, applied after the union.
   */
  it("shares the per-owner DAILY_CAP across both sources instead of adding to it", async () => {
    const jobRows = Array.from({ length: 20 }, (_, i) => contactRow(`jc${i}`, "o1"));
    const radarRows = Array.from({ length: 20 }, (_, i) =>
      i === 0 ? radarRow("jc0", "o1") : radarRow(`rd${i}`, "o1")
    );

    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? radarRows : jobRows)
    );

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(created).toBe(25);
    expect(new Set(createdIds()).size).toBe(25); // no contact double-booked
  });

  /**
   * Sharing one cap is not enough on its own. Both sources sort never-touched rows to
   * -Infinity, and a stable sort keeps whichever was pushed first — so an owner with a
   * bottomless never-checked job-check pool (the pilot owner has ~16k) took all 25 slots
   * every single night and a hand-marked radar person waited forever. RADAR_RESERVED_SLOTS
   * is the floor that stops the starvation; the reservation is never a waste, because any
   * slot radar doesn't claim goes straight back to job-check.
   */
  it("reserves RADAR_RESERVED_SLOTS for radar when job-check alone could fill the cap", async () => {
    const jobRows = Array.from({ length: 40 }, (_, i) => contactRow(`jc${i}`, "o1"));
    const radarRows = Array.from({ length: 15 }, (_, i) => radarRow(`rd${i}`, "o1"));
    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? radarRows : jobRows)
    );

    const { dispatchJobChecks, RADAR_RESERVED_SLOTS } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    const ids = createdIds();
    expect(created).toBe(25);
    expect(ids.filter((id) => id.startsWith("rd"))).toHaveLength(RADAR_RESERVED_SLOTS);
    expect(ids.filter((id) => id.startsWith("jc"))).toHaveLength(25 - RADAR_RESERVED_SLOTS);
  });

  it("hands the reserved slots radar does not use back to job-check", async () => {
    const jobRows = Array.from({ length: 40 }, (_, i) => contactRow(`jc${i}`, "o1"));
    const radarRows = Array.from({ length: 3 }, (_, i) => radarRow(`rd${i}`, "o1"));
    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? radarRows : jobRows)
    );

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    const ids = createdIds();
    expect(created).toBe(25);
    expect(ids.filter((id) => id.startsWith("rd"))).toHaveLength(3);
    expect(ids.filter((id) => id.startsWith("jc"))).toHaveLength(22);
  });

  /**
   * The reservation is a floor, not a ceiling — the live pilot org has jobCheckEnabled:
   * false, so its job-check source returns nothing and radar must still be allowed the
   * whole per-owner budget. Capping radar at 10 here would be a fresh regression on the
   * one configuration running today.
   */
  it("lets radar use the whole cap when the job-check source has nothing due", async () => {
    const radarRows = Array.from({ length: 40 }, (_, i) => radarRow(`rd${i}`, "o1"));
    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? radarRows : [])
    );

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(created).toBe(25);
    expect(createdIds().every((id) => id.startsWith("rd"))).toBe(true);
  });

  it("never exceeds DAILY_CAP per owner, and caps each owner independently", async () => {
    const jobRows = Array.from({ length: 40 }, (_, i) => contactRow(`jc${i}`, "o1"));
    const radarRows = [
      ...Array.from({ length: 15 }, (_, i) => radarRow(`rd${i}`, "o1")),
      ...Array.from({ length: 4 }, (_, i) => radarRow(`rd2-${i}`, "o2")),
    ];
    mockContactFindMany.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.radarInclude ? radarRows : jobRows)
    );

    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    const created = await dispatchJobChecks();

    expect(created).toBe(29); // 25 for o1 + 4 for o2
    const ids = createdIds();
    expect(ids.filter((id) => id.startsWith("rd2-"))).toHaveLength(4);
  });
});
