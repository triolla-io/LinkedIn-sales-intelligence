import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const runFindFirst = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());
const targetFindFirst = vi.hoisted(() => vi.fn());
const targetUpdate = vi.hoisted(() => vi.fn());
const taskUpdateMany = vi.hoisted(() => vi.fn());
const reqFindMany = vi.hoisted(() => vi.fn());
const reqUpdateMany = vi.hoisted(() => vi.fn());
const releaseSlot = vi.hoisted(() => vi.fn());
const queueNext = vi.hoisted(() => vi.fn());
const startNext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({
  releaseConnectSlot: releaseSlot,
  queueNextConnect: queueNext,
}));
vi.mock("@/lib/prospecting/company-discovery", () => ({
  startNextPendingTarget: startNext,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findFirst: runFindFirst },
    prospectingCompanyTarget: {
      findFirst: targetFindFirst,
      update: targetUpdate,
    },
    extensionTask: { updateMany: taskUpdateMany },
    connectionRequest: { findMany: reqFindMany, updateMany: reqUpdateMany },
    user: { findUnique: userFindUnique, findUniqueOrThrow: userFindUnique },
  },
}));

const USER = {
  id: "user1",
  orgId: "org1",
  role: "SALESPERSON",
  routineConnectionsEnabled: true,
  org: { id: "org1", name: "Org" },
};

function del() {
  return new NextRequest("http://test/api/prospecting/runs/run1/companies/t1", {
    method: "DELETE",
  });
}
const params = { params: Promise.resolve({ id: "run1", targetId: "t1" }) };

describe("DELETE /api/prospecting/runs/[id]/companies/[targetId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    userFindUnique.mockResolvedValue(USER);
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "RUNNING",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    targetFindFirst.mockResolvedValue({
      id: "t1",
      runId: "run1",
      status: "SEARCHING",
    });
    targetUpdate.mockResolvedValue({});
  });

  it("removes the target, cancels tasks + unsent people, releases the slot", async () => {
    // 1st updateMany: discovery tasks (count 1 → advance discovery); 2nd: connect tasks (count 1 → release slot)
    taskUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    reqFindMany.mockResolvedValue([{ id: "cr1" }, { id: "cr2" }]);
    reqUpdateMany.mockResolvedValue({ count: 2 });
    const { DELETE } =
      await import("@/app/api/prospecting/runs/[id]/companies/[targetId]/route");
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cancelled: 2 });
    expect(targetUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "REMOVED" },
    });
    expect(taskUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        prospectingRunId: "run1",
        status: "PENDING",
        payload: { path: ["targetId"], equals: "t1" },
      },
      data: { status: "CANCELLED" },
    });
    expect(reqUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["cr1", "cr2"] } },
      data: { status: "SKIPPED", skipReason: "company_removed" },
    });
    expect(taskUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        prospectingRunId: "run1",
        kind: "CONNECT",
        status: "PENDING",
        connectionRequestId: { in: ["cr1", "cr2"] },
      },
      data: { status: "CANCELLED" },
    });
    expect(releaseSlot).toHaveBeenCalledWith("run1");
    expect(queueNext).toHaveBeenCalledWith("run1");
    expect(startNext).toHaveBeenCalledWith("run1");
  });

  it("does not release the slot when no CONNECT task was cancelled", async () => {
    taskUpdateMany.mockResolvedValue({ count: 0 });
    reqFindMany.mockResolvedValue([]);
    const { DELETE } =
      await import("@/app/api/prospecting/runs/[id]/companies/[targetId]/route");
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(releaseSlot).not.toHaveBeenCalled();
    expect(startNext).not.toHaveBeenCalled();
  });

  it("404s for a target that is not in this run", async () => {
    targetFindFirst.mockResolvedValue(null);
    const { DELETE } =
      await import("@/app/api/prospecting/runs/[id]/companies/[targetId]/route");
    const res = await DELETE(del(), params);
    expect(res.status).toBe(404);
  });
});
