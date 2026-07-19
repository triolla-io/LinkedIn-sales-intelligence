import { describe, it, expect, vi, beforeEach } from "vitest";

const runFindMany = vi.hoisted(() => vi.fn());
const runUpdateMany = vi.hoisted(() => vi.fn());
const taskFindFirst = vi.hoisted(() => vi.fn());
const taskCreate = vi.hoisted(() => vi.fn());
const targetFindFirst = vi.hoisted(() => vi.fn());
const queueNext = vi.hoisted(() => vi.fn());
const enqueueResolve = vi.hoisted(() => vi.fn());
const enqueueSearch = vi.hoisted(() => vi.fn());
const startNext = vi.hoisted(() => vi.fn());
const maybeComplete = vi.hoisted(() => vi.fn());

vi.mock("@/inngest/client", () => ({
  inngest: {
    createFunction: (_opts: unknown, handler: unknown) => ({ handler }),
    send: vi.fn(),
  },
}));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({
  queueNextConnect: queueNext,
  SEARCH_FAIL_CAP: 5,
}));
vi.mock("@/lib/prospecting/company-discovery", () => ({
  enqueueResolveTask: enqueueResolve,
  enqueueCompanySearchTask: enqueueSearch,
  startNextPendingTarget: startNext,
  maybeCompleteCompanyRun: maybeComplete,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findMany: runFindMany, updateMany: runUpdateMany },
    extensionTask: { findFirst: taskFindFirst, create: taskCreate },
    prospectingCompanyTarget: { findFirst: targetFindFirst },
  },
}));

const BASE_RUN = {
  id: "run1",
  ownerId: "user1",
  status: "RUNNING",
  targetType: "COMPANY",
  keywords: "CEO",
  geoUrn: "",
  industryIds: [],
  discoveryDone: false,
  connectInFlight: false,
  searchFailCount: 0,
  pausedUntil: null,
  nextDiscoveryAt: null,
  nextSearchPage: 1,
  owner: { routineConnectionsEnabled: true },
};

async function runTick() {
  const mod = await import("@/inngest/functions/prospecting-tick");
  // inngest.createFunction is mocked to expose the raw handler
  await (
    mod.prospectingTick as unknown as { handler: () => Promise<void> }
  ).handler();
}

describe("prospecting-tick for COMPANY runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("re-queues a dropped SEARCH for the in-flight target", async () => {
    runFindMany.mockResolvedValue([{ ...BASE_RUN }]);
    taskFindFirst.mockResolvedValue(null); // no live discovery task
    targetFindFirst.mockResolvedValue({
      id: "t1",
      name: "Acme",
      linkedinUrl: null,
      linkedinCompanyId: "1441",
      searchPage: 3,
      status: "SEARCHING",
    });
    await runTick();
    expect(enqueueSearch).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run1" }),
      expect.objectContaining({ id: "t1" }),
      3,
    );
    expect(taskCreate).not.toHaveBeenCalled(); // never the keyword SEARCH path
  });

  it("re-queues a dropped RESOLVE when the in-flight target has no company id", async () => {
    runFindMany.mockResolvedValue([{ ...BASE_RUN }]);
    taskFindFirst.mockResolvedValue(null);
    targetFindFirst.mockResolvedValue({
      id: "t1",
      name: "Acme",
      linkedinUrl: null,
      linkedinCompanyId: null,
      searchPage: 1,
      status: "RESOLVING",
    });
    await runTick();
    expect(enqueueResolve).toHaveBeenCalled();
  });

  it("starts the next PENDING target when nothing is in flight", async () => {
    runFindMany.mockResolvedValue([{ ...BASE_RUN }]);
    taskFindFirst.mockResolvedValue(null);
    targetFindFirst.mockResolvedValue(null);
    await runTick();
    expect(startNext).toHaveBeenCalledWith("run1");
  });

  it("leaves live discovery alone and never re-discovers after done", async () => {
    runFindMany.mockResolvedValue([
      { ...BASE_RUN, discoveryDone: true, nextDiscoveryAt: new Date(0) },
    ]);
    await runTick();
    expect(maybeComplete).toHaveBeenCalledWith("run1");
    expect(taskCreate).not.toHaveBeenCalled();
    expect(runUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextDiscoveryAt: expect.anything() }),
      }),
    );
  });
});
