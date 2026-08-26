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

beforeEach(() => {
  vi.clearAllMocks();
  mockExtensionTaskUpdateMany.mockResolvedValue({ count: 0 });
  mockExtensionTaskFindMany.mockResolvedValue([]);
  mockExtensionTaskCreateMany.mockResolvedValue({ count: 0 });
});

describe("dispatchJobChecks backlog expiry", () => {
  it("cancels PENDING SCRAPE_PROFILE tasks older than PENDING_EXPIRY_DAYS before deduping", async () => {
    mockContactFindMany.mockResolvedValue([]);
    const { dispatchJobChecks, PENDING_EXPIRY_DAYS } = await import("@/lib/job-check/dispatch");

    const before = Date.now();
    await dispatchJobChecks();

    expect(mockExtensionTaskUpdateMany).toHaveBeenCalledWith({
      where: {
        kind: "SCRAPE_PROFILE",
        status: "PENDING",
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

  it("a radar contact scraped 10 days ago does not get a fresh task (DB-level: excluded from the returned rows)", async () => {
    // The where clause's OR excludes a contact scraped within the window — simulated here
    // by the source returning nothing, as a real WHERE would for a 10-day-old scrape.
    mockContactFindMany.mockResolvedValue([]);
    const { dispatchJobChecks } = await import("@/lib/job-check/dispatch");
    expect(await dispatchJobChecks()).toBe(0);
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
    const createdIds = mockExtensionTaskCreateMany.mock.calls[0][0].data.map(
      (d: { payload: { contactId: string } }) => d.payload.contactId
    );
    expect(new Set(createdIds).size).toBe(25); // no contact double-booked
  });
});
