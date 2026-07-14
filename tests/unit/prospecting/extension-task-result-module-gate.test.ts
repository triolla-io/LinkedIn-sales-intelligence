import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockTaskFindUnique = vi.fn();
const mockTaskCreate = vi.fn();
const mockRunFindUnique = vi.fn();
const mockRunUpdate = vi.fn();
const mockRunUpdateMany = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    extensionTask: { findUnique: mockTaskFindUnique, create: mockTaskCreate },
    prospectingRun: {
      findUnique: mockRunFindUnique,
      update: mockRunUpdate,
      updateMany: mockRunUpdateMany,
    },
    user: { findUnique: mockUserFindUnique },
    connectionRequest: { count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    extensionAlert: { create: vi.fn() },
    prospectingEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/prospecting/candidates", () => ({ persistCandidates: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({ queueNextConnect: vi.fn().mockResolvedValue(null), releaseConnectSlot: vi.fn(), SEARCH_FAIL_CAP: 5 }));
vi.mock("@/lib/sequences/gating", () => ({ maybeCompleteEnrollment: vi.fn() }));
vi.mock("@/lib/prospecting/search-url", () => ({ buildSearchUrl: vi.fn().mockReturnValue("https://linkedin.com/search?page=2") }));
vi.mock("@/lib/prospecting/events", () => ({ logProspectingEvent: vi.fn() }));
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn(), createFunction: vi.fn() } }));

// Base task fixture — a SEARCH task that is DONE with hasNextPage = true.
const BASE_TASK = {
  id: "task1",
  kind: "SEARCH",
  status: "DONE",
  userId: "u1",
  prospectingRunId: "run1",
  result: { candidates: [], hasNextPage: true },
  payload: {},
  recipientId: null,
  sequenceExecutionId: null,
  connectionRequestId: null,
  errorCode: null,
  errorMessage: null,
};

// Run fixture
const BASE_RUN = {
  id: "run1",
  ownerId: "u1",
  status: "RUNNING",
  nextSearchPage: 1,
  searchFailCount: 0,
  keywords: "engineer",
  geoUrn: null,
  industryIds: [],
  discoveryDone: false,
  nextDiscoveryAt: null,
};

describe("handleSearchResult — connections module gate on hasNextPage chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskFindUnique.mockResolvedValue(BASE_TASK);
    mockRunFindUnique.mockResolvedValue(BASE_RUN);
    // updateMany used for atomic page-cursor advance — return count 1 to show it would have proceeded.
    mockRunUpdateMany.mockResolvedValue({ count: 1 });
    mockRunUpdate.mockResolvedValue({ ...BASE_RUN });
  });

  it("module OFF → no new SEARCH extensionTask created for the next page", async () => {
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: false });

    const { extensionTaskResultHandler } = await import("@/inngest/functions/extension-task-result");
    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    // extensionTask.create must NOT have been called with kind "SEARCH"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchCreates = mockTaskCreate.mock.calls.filter((args: any[]) => args[0]?.data?.kind === "SEARCH");
    expect(searchCreates).toHaveLength(0);
  });

  it("module ON → next SEARCH extensionTask IS created", async () => {
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: true });

    const { extensionTaskResultHandler } = await import("@/inngest/functions/extension-task-result");
    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchCreates = mockTaskCreate.mock.calls.filter((args: any[]) => args[0]?.data?.kind === "SEARCH");
    expect(searchCreates).toHaveLength(1);
    expect(searchCreates[0][0]).toMatchObject({ data: { kind: "SEARCH", userId: "u1", prospectingRunId: "run1" } });
  });

  it("module OFF → run status is NOT mutated by the toggle", async () => {
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: false });

    const { extensionTaskResultHandler } = await import("@/inngest/functions/extension-task-result");
    await extensionTaskResultHandler({ event: { data: { taskId: "task1" } } });

    // discoveryDone should not be set — no update with discoveryDone:true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discoveryDoneUpdates = mockRunUpdate.mock.calls.filter((args: any[]) => args[0]?.data?.discoveryDone === true);
    expect(discoveryDoneUpdates).toHaveLength(0);
  });
});
