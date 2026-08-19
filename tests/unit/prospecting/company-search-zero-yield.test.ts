import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression — adi@triolla.io's Playtika company run (2026-08-18).
 *
 * Three title searches scraped 8 + 8 + 9 people. Every one of them held the wrong role, so the
 * title filter dropped all 25 without writing a row, an event or a counter. The company was marked
 * DONE, the run COMPLETED, and the UI showed "0 נמצאו · 0 דולגו · הריצה הושלמה" — identical to a run
 * whose searches returned nothing at all. These tests pin the outcome down as reportable.
 */

const mockTaskFindUnique = vi.hoisted(() => vi.fn());
const mockTaskCreate = vi.hoisted(() => vi.fn());
const mockTaskFindFirst = vi.hoisted(() => vi.fn());
const mockRunFindUnique = vi.hoisted(() => vi.fn());
const mockRunUpdate = vi.hoisted(() => vi.fn());
const mockRunUpdateMany = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockTargetFindUnique = vi.hoisted(() => vi.fn());
const mockTargetUpdate = vi.hoisted(() => vi.fn());
const mockTargetUpdateMany = vi.hoisted(() => vi.fn());
const mockTargetCount = vi.hoisted(() => vi.fn());
const mockRequestCount = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    extensionTask: { findUnique: mockTaskFindUnique, create: mockTaskCreate, findFirst: mockTaskFindFirst, updateMany: vi.fn() },
    prospectingRun: { findUnique: mockRunFindUnique, update: mockRunUpdate, updateMany: mockRunUpdateMany },
    prospectingCompanyTarget: {
      findUnique: mockTargetFindUnique,
      update: mockTargetUpdate,
      updateMany: mockTargetUpdateMany,
      count: mockTargetCount,
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { findUnique: mockUserFindUnique },
    connectionRequest: { count: mockRequestCount, findFirst: vi.fn(), updateMany: vi.fn() },
    extensionAlert: { create: vi.fn() },
    prospectingEvent: { create: vi.fn() },
  },
}));

const persistCandidates = vi.hoisted(() => vi.fn());
const logProspectingEvent = vi.hoisted(() => vi.fn());
const startNextPendingTarget = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prospecting/candidates", () => ({ persistCandidates }));
vi.mock("@/lib/prospecting/events", () => ({ logProspectingEvent }));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({
  queueNextConnect: vi.fn(), releaseConnectSlot: vi.fn(), stampWarmupStart: vi.fn(), SEARCH_FAIL_CAP: 5,
}));
vi.mock("@/lib/prospecting/company-discovery", () => ({
  buildCompanySearchUrl: vi.fn().mockReturnValue("https://www.linkedin.com/search/results/people/?keywords=x"),
  enqueueCompanySearchTask: vi.fn(),
  failCompanyTarget: vi.fn(),
  interCompanyDelayMs: vi.fn().mockReturnValue(0),
  maybeCompleteCompanyRun: vi.fn(),
  startNextPendingTarget,
  COMPANY_NETWORK: ["S", "O"],
}));
vi.mock("@/lib/sequences/gating", () => ({ maybeCompleteEnrollment: vi.fn() }));
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn(), createFunction: vi.fn() } }));

import { extensionTaskResultHandler } from "@/inngest/functions/extension-task-result";

// The real run: targetType COMPANY, keywords "product" → 3 titles (CPO / "VP Product" / "Head of Product").
const RUN = {
  id: "run1", ownerId: "u1", status: "RUNNING", targetType: "COMPANY",
  keywords: "product", geoUrn: "101620260", industryIds: [], nextSearchPage: 1,
  searchFailCount: 0, discoveryDone: false, nextDiscoveryAt: null, totalDiscovered: 0,
};

const target = (over: Record<string, unknown> = {}) => ({
  id: "t1", name: "playtika", linkedinUrl: null, linkedinCompanyId: "1919232",
  status: "SEARCHING", searchPage: 1, searchTitleIndex: 0,
  discoveredCount: 0, scannedCount: 0, ...over,
});

const task = (cards: number) => ({
  id: "task1", kind: "SEARCH", status: "DONE", userId: "u1", prospectingRunId: "run1",
  payload: { targetId: "t1", page: 1 },
  result: { candidates: Array.from({ length: cards }, (_, i) => ({ urn: `p${i}` })), hasNextPage: false },
  errorCode: null, errorMessage: null,
});

const messages = () => logProspectingEvent.mock.calls.map((c) => String(c[0].message));

describe("company search that scanned people but matched nobody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunFindUnique.mockResolvedValue(RUN);
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: true });
    mockTargetUpdate.mockResolvedValue({});
    mockTargetUpdateMany.mockResolvedValue({ count: 1 });
    mockTaskCreate.mockResolvedValue({});
    mockRunUpdate.mockResolvedValue({});
    mockRunUpdateMany.mockResolvedValue({ count: 1 });
    mockTargetCount.mockResolvedValue(0);
    mockRequestCount.mockResolvedValue(0);
    mockTaskFindFirst.mockResolvedValue(null);
  });

  it("reports the page that scanned 8 people and matched none", async () => {
    mockTaskFindUnique.mockResolvedValue(task(8));
    mockTargetFindUnique.mockResolvedValue(target({ searchTitleIndex: 1 }));
    persistCandidates.mockResolvedValue({ inserted: 0, skipped: 0, filtered: 8 });

    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    const msg = messages().join(" | ");
    expect(msg).toContain("playtika");
    expect(msg).toContain("VP Product");
    expect(msg).toContain("8");
  });

  it("explains a company that finishes with everyone filtered out", async () => {
    mockTaskFindUnique.mockResolvedValue(task(9));
    // Last title (index 2 of 3) → the company is finished by this result.
    mockTargetFindUnique
      .mockResolvedValueOnce(target({ searchTitleIndex: 2 }))
      .mockResolvedValue(target({ searchTitleIndex: 2, status: "DONE", scannedCount: 25, discoveredCount: 0 }));
    persistCandidates.mockResolvedValue({ inserted: 0, skipped: 0, filtered: 9 });

    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    expect(mockTargetUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "DONE" } }),
    );
    const summary = messages().find((m) => m.includes("25"));
    expect(summary, `no scanned-total event in: ${messages().join(" | ")}`).toBeTruthy();
    expect(summary).toContain("playtika");
  });

  it("stays quiet when LinkedIn genuinely returned nobody", async () => {
    mockTaskFindUnique.mockResolvedValue(task(0));
    mockTargetFindUnique.mockResolvedValue(target({ searchTitleIndex: 1 }));
    persistCandidates.mockResolvedValue({ inserted: 0, skipped: 0, filtered: 0 });

    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    expect(messages().filter((m) => /נסרקו/.test(m))).toHaveLength(0);
  });
});
