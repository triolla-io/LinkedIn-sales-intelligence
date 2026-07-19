import { describe, it, expect, vi, beforeEach } from "vitest";

const runFindUnique = vi.hoisted(() => vi.fn());
const runUpdateMany = vi.hoisted(() => vi.fn());
const targetFindFirst = vi.hoisted(() => vi.fn());
const targetFindUnique = vi.hoisted(() => vi.fn());
const targetUpdate = vi.hoisted(() => vi.fn());
const targetUpdateMany = vi.hoisted(() => vi.fn());
const targetCount = vi.hoisted(() => vi.fn());
const requestCount = vi.hoisted(() => vi.fn());
const taskCreate = vi.hoisted(() => vi.fn());
const taskFindFirst = vi.hoisted(() => vi.fn());
const eventCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findUnique: runFindUnique, updateMany: runUpdateMany },
    prospectingCompanyTarget: {
      findFirst: targetFindFirst,
      findUnique: targetFindUnique,
      update: targetUpdate,
      updateMany: targetUpdateMany,
      count: targetCount,
    },
    connectionRequest: { count: requestCount },
    extensionTask: { create: taskCreate, findFirst: taskFindFirst },
    prospectingEvent: { create: eventCreate },
  },
}));

import {
  interCompanyDelayMs,
  buildCompanySearchUrl,
  enqueueCompanySearchTask,
  startNextPendingTarget,
  maybeCompleteCompanyRun,
  failCompanyTarget,
} from "@/lib/prospecting/company-discovery";

describe("interCompanyDelayMs", () => {
  it("stays inside the humanized 2-5 minute window", () => {
    for (let i = 0; i < 50; i++) {
      const d = interCompanyDelayMs();
      expect(d).toBeGreaterThanOrEqual(120_000);
      expect(d).toBeLessThan(300_000);
    }
  });
});

describe("buildCompanySearchUrl", () => {
  it("builds a single-title currentCompany search with S+O network", () => {
    const url = new URL(buildCompanySearchUrl({ geoUrn: "" }, "1441", 2, "CEO"));
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
    expect(url.searchParams.get("network")).toBe('["S","O"]');
    expect(url.searchParams.get("geoUrn")).toBeNull();
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("keywords")).toBe("CEO");
  });
});

describe("startNextPendingTarget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims the oldest PENDING target and enqueues RESOLVE_COMPANY with the delay", async () => {
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    targetFindFirst.mockResolvedValue({
      id: "t1",
      name: "Acme",
      linkedinUrl: null,
      status: "PENDING",
    });
    targetUpdateMany.mockResolvedValue({ count: 1 });
    const before = Date.now();
    const started = await startNextPendingTarget("run1", 120_000);
    expect(started).toBe(true);
    expect(targetUpdateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: "PENDING" },
      data: { status: "RESOLVING" },
    });
    const created = taskCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      userId: "user1",
      kind: "RESOLVE_COMPANY",
      prospectingRunId: "run1",
      payload: { targetId: "t1", linkedinUrl: null, name: "Acme" },
    });
    expect(created.scheduledFor.getTime()).toBeGreaterThanOrEqual(
      before + 120_000,
    );
  });

  it("marks discovery done and checks completion when no PENDING targets remain", async () => {
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    targetFindFirst.mockResolvedValue(null);
    runUpdateMany.mockResolvedValue({ count: 1 });
    targetCount.mockResolvedValue(0);
    requestCount.mockResolvedValue(0);
    taskFindFirst.mockResolvedValue(null);
    // second runFindUnique call is inside maybeCompleteCompanyRun
    runFindUnique.mockResolvedValueOnce({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    runFindUnique.mockResolvedValueOnce({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: true,
    });
    const started = await startNextPendingTarget("run1");
    expect(started).toBe(false);
    expect(runUpdateMany).toHaveBeenCalledWith({
      where: { id: "run1", discoveryDone: false },
      data: { discoveryDone: true },
    });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("does not double-start when another handler already claimed the target", async () => {
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
    });
    targetFindFirst.mockResolvedValue({
      id: "t1",
      name: "Acme",
      linkedinUrl: null,
      status: "PENDING",
    });
    targetUpdateMany.mockResolvedValue({ count: 0 });
    const started = await startNextPendingTarget("run1");
    expect(started).toBe(false);
    expect(taskCreate).not.toHaveBeenCalled();
  });
});

describe("maybeCompleteCompanyRun", () => {
  beforeEach(() => vi.clearAllMocks());

  const RUN = {
    id: "run1",
    status: "RUNNING",
    targetType: "COMPANY",
    discoveryDone: true,
  };

  it("completes the run when everything is terminal", async () => {
    runFindUnique.mockResolvedValue(RUN);
    targetCount.mockResolvedValue(0);
    requestCount.mockResolvedValue(0);
    taskFindFirst.mockResolvedValue(null);
    runUpdateMany.mockResolvedValue({ count: 1 });
    await maybeCompleteCompanyRun("run1");
    expect(runUpdateMany).toHaveBeenCalledWith({
      where: { id: "run1", status: "RUNNING" },
      data: expect.objectContaining({
        status: "COMPLETED",
        connectInFlight: false,
      }),
    });
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "COMPLETED" }),
      }),
    );
  });

  it.each([
    ["non-terminal targets", 1, 0, null],
    ["unsent people", 0, 2, null],
    ["a live task", 0, 0, { id: "task1" }],
  ])("does not complete with %s", async (_label, targets, requests, task) => {
    runFindUnique.mockResolvedValue(RUN);
    targetCount.mockResolvedValue(targets);
    requestCount.mockResolvedValue(requests);
    taskFindFirst.mockResolvedValue(task);
    await maybeCompleteCompanyRun("run1");
    expect(runUpdateMany).not.toHaveBeenCalled();
  });

  it("never completes a KEYWORDS run", async () => {
    runFindUnique.mockResolvedValue({ ...RUN, targetType: "KEYWORDS" });
    await maybeCompleteCompanyRun("run1");
    expect(runUpdateMany).not.toHaveBeenCalled();
    expect(targetCount).not.toHaveBeenCalled();
  });
});

describe("enqueueCompanySearchTask (per-title)", () => {
  beforeEach(() => vi.clearAllMocks());
  const RUN = { id: "run1", ownerId: "u1", keywords: "CEO, CTO", geoUrn: "" };
  const target = (over: Record<string, unknown>) => ({
    id: "t1",
    name: "Acme",
    linkedinUrl: null,
    linkedinCompanyId: "1441",
    searchPage: 1,
    searchTitleIndex: 0,
    ...over,
  });

  it("searches the single title at searchTitleIndex", async () => {
    targetUpdate.mockResolvedValue({});
    await enqueueCompanySearchTask(RUN, target({ searchTitleIndex: 1 }), 1);
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "SEARCHING" },
    });
    const url = new URL(taskCreate.mock.calls[0][0].data.payload.searchUrl);
    expect(url.searchParams.get("keywords")).toBe("CTO"); // index 1, not "CEO"
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
  });

  it("finishes the company (DONE + advance) once the title cursor runs past the list", async () => {
    targetUpdateMany.mockResolvedValue({ count: 1 });
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "u1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    targetFindFirst.mockResolvedValue(null);
    runUpdateMany.mockResolvedValue({ count: 1 });
    targetCount.mockResolvedValue(0);
    requestCount.mockResolvedValue(0);
    taskFindFirst.mockResolvedValue(null);
    await enqueueCompanySearchTask(RUN, target({ searchTitleIndex: 2 }), 1);
    expect(targetUpdateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: { in: ["READY", "SEARCHING"] } },
      data: { status: "DONE" },
    });
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it("falls back to RESOLVE_COMPANY when the numeric id is missing", async () => {
    targetUpdate.mockResolvedValue({});
    await enqueueCompanySearchTask(
      RUN,
      target({ linkedinCompanyId: null }),
      1,
    );
    expect(taskCreate.mock.calls[0][0].data.kind).toBe("RESOLVE_COMPANY");
  });
});

describe("failCompanyTarget", () => {
  it("marks the target FAILED, logs an event, and advances", async () => {
    vi.clearAllMocks();
    targetUpdate.mockResolvedValue({});
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "u1",
      status: "RUNNING",
    });
    targetFindFirst.mockResolvedValue(null);
    runUpdateMany.mockResolvedValue({ count: 1 });
    targetCount.mockResolvedValue(0);
    requestCount.mockResolvedValue(1); // still people to send — no completion
    taskFindFirst.mockResolvedValue(null);
    await failCompanyTarget("run1", { id: "t1", name: "Acme" }, "not_found");
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "FAILED", error: "not_found" },
    });
    expect(eventCreate).toHaveBeenCalled();
  });
});
