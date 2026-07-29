import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const runFindUnique = vi.hoisted(() => vi.fn());
const runUpdateMany = vi.hoisted(() => vi.fn());
const targetFindFirst = vi.hoisted(() => vi.fn());
const targetFindUnique = vi.hoisted(() => vi.fn());
const targetFindMany = vi.hoisted(() => vi.fn());
const targetUpdate = vi.hoisted(() => vi.fn());
const targetUpdateMany = vi.hoisted(() => vi.fn());
const targetCount = vi.hoisted(() => vi.fn());
const requestCount = vi.hoisted(() => vi.fn());
const taskCreate = vi.hoisted(() => vi.fn());
const taskFindFirst = vi.hoisted(() => vi.fn());
const taskCount = vi.hoisted(() => vi.fn());
const eventCreate = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findUnique: runFindUnique, updateMany: runUpdateMany },
    prospectingCompanyTarget: {
      findFirst: targetFindFirst,
      findUnique: targetFindUnique,
      findMany: targetFindMany,
      update: targetUpdate,
      updateMany: targetUpdateMany,
      count: targetCount,
    },
    connectionRequest: { count: requestCount },
    extensionTask: { create: taskCreate, findFirst: taskFindFirst, count: taskCount },
    prospectingEvent: { create: eventCreate },
    user: { findUnique: userFindUnique },
  },
}));

// Discovery is clamped to 09:00-21:00 on the run's sendDays — freeze the clock
// inside that window (Tuesday 12:00 Jerusalem) so scheduling is deterministic.
const INSIDE_DISCOVERY_HOURS = new Date("2026-07-28T09:00:00Z");
const OPEN_WINDOW = { sendDays: [0, 1, 2, 3, 4, 5, 6] };

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: INSIDE_DISCOVERY_HOURS });
    taskCount.mockResolvedValue(0);
  });
  afterEach(() => vi.useRealTimers());

  it("daily discovery cap reached → schedules tomorrow at window start, not today", async () => {
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
      ...OPEN_WINDOW,
    });
    userFindUnique.mockResolvedValue({ timezone: "Asia/Jerusalem" });
    targetFindFirst.mockResolvedValue({ id: "t1", name: "Acme", linkedinUrl: null, status: "PENDING" });
    targetUpdateMany.mockResolvedValue({ count: 1 });
    taskCount.mockResolvedValue(100); // DISCOVERY_DAILY_CAP used up
    await startNextPendingTarget("run1");
    const created = taskCreate.mock.calls[0][0].data;
    // Tuesday noon Jerusalem + capped → Wednesday 09:00 Jerusalem (06:00 UTC)
    expect(created.scheduledFor.toISOString()).toBe("2026-07-29T06:00:00.000Z");
  });

  it("claims the oldest PENDING target and enqueues RESOLVE_COMPANY with the delay", async () => {
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "user1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
      ...OPEN_WINDOW,
    });
    userFindUnique.mockResolvedValue({ timezone: "Asia/Jerusalem" });
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: INSIDE_DISCOVERY_HOURS });
    userFindUnique.mockResolvedValue({ timezone: "Asia/Jerusalem" });
    taskCount.mockResolvedValue(0);
  });
  afterEach(() => vi.useRealTimers());
  const RUN = { id: "run1", ownerId: "u1", keywords: "CEO, CTO", geoUrn: "", ...OPEN_WINDOW };
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
    // parseSearchTitles("CEO, CTO") now expands each title via its role family:
    // ["CEO", "Founder", "CTO", "\"VP Engineering\"", "\"VP R&D\""]. Index 1 is
    // the CEO family's second search term, "Founder" — not "CEO" and not "CTO".
    targetUpdate.mockResolvedValue({});
    await enqueueCompanySearchTask(RUN, target({ searchTitleIndex: 1 }), 1);
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "SEARCHING" },
    });
    const url = new URL(taskCreate.mock.calls[0][0].data.payload.searchUrl);
    expect(url.searchParams.get("keywords")).toBe("Founder"); // index 1, not "CEO"
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
  });

  it("finishes the company (DONE + advance) once the title cursor runs past the list", async () => {
    // Expanded list has 5 entries (see above); index 5 is one past the last.
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
    await enqueueCompanySearchTask(RUN, target({ searchTitleIndex: 5 }), 1);
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: INSIDE_DISCOVERY_HOURS });
    taskCount.mockResolvedValue(0);
    targetUpdate.mockResolvedValue({});
    runFindUnique.mockResolvedValue({
      id: "run1",
      ownerId: "u1",
      status: "RUNNING",
      ...OPEN_WINDOW,
    });
    userFindUnique.mockResolvedValue({ timezone: "Asia/Jerusalem" });
    runUpdateMany.mockResolvedValue({ count: 1 });
    targetCount.mockResolvedValue(0);
    requestCount.mockResolvedValue(1); // still people to send — no completion
    taskFindFirst.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it("marks the target FAILED, logs an event, and advances", async () => {
    targetFindMany.mockResolvedValue([{ status: "FAILED" }, { status: "DONE" }]); // no wave
    targetFindFirst.mockResolvedValue(null);
    await failCompanyTarget("run1", { id: "t1", name: "Acme" }, "not_found");
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "FAILED", error: "not_found" },
    });
    expect(eventCreate).toHaveBeenCalled();
  });

  it("advances with the humanized 2-5 min delay — never immediately (the 26.7 burn)", async () => {
    targetFindMany.mockResolvedValue([{ status: "FAILED" }, { status: "DONE" }]);
    targetFindFirst.mockResolvedValue({ id: "t2", name: "Next Co", linkedinUrl: null, status: "PENDING" });
    targetUpdateMany.mockResolvedValue({ count: 1 });
    const before = Date.now();
    await failCompanyTarget("run1", { id: "t1", name: "Acme" }, "no_id");
    const created = taskCreate.mock.calls[0][0].data;
    expect(created.kind).toBe("RESOLVE_COMPANY");
    expect(created.scheduledFor.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(created.scheduledFor.getTime()).toBeLessThan(before + 305_000);
  });

  it("trips the breaker after 5 consecutive failures: pauses the run instead of queueing the next company", async () => {
    targetFindMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ status: "FAILED" })));
    const before = Date.now();
    await failCompanyTarget("run1", { id: "t1", name: "Acme" }, "no_id");
    // Run paused for the backoff window.
    const pauseCall = runUpdateMany.mock.calls.find((c) => c[0]?.data?.pausedUntil);
    expect(pauseCall).toBeTruthy();
    expect(pauseCall![0].data.pausedUntil.getTime()).toBeGreaterThanOrEqual(before + 6 * 60 * 60 * 1000 - 1000);
    // No next company queued while paused.
    expect(taskCreate).not.toHaveBeenCalled();
    // A breaker event was logged for the run page.
    const breakerEvent = eventCreate.mock.calls.find((c) => c[0]?.data?.detail?.breaker);
    expect(breakerEvent).toBeTruthy();
  });

  it("does not trip the breaker when a success sits inside the last 5", async () => {
    targetFindMany.mockResolvedValue([
      { status: "FAILED" },
      { status: "FAILED" },
      { status: "DONE" },
      { status: "FAILED" },
      { status: "FAILED" },
    ]);
    targetFindFirst.mockResolvedValue(null);
    await failCompanyTarget("run1", { id: "t1", name: "Acme" }, "no_id");
    const pauseCall = runUpdateMany.mock.calls.find((c) => c[0]?.data?.pausedUntil);
    expect(pauseCall).toBeFalsy();
  });
});
