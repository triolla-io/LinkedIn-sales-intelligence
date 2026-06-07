import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockExecCount = vi.hoisted(() => vi.fn());
const mockEnrUpdateMany = vi.hoisted(() => vi.fn());
const mockEnrFindUnique = vi.hoisted(() => vi.fn());
const mockEnrCount = vi.hoisted(() => vi.fn());
const mockSeqUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sequenceStepExecution: { findUnique: mockFindUnique, count: mockExecCount },
    sequenceEnrollment: { updateMany: mockEnrUpdateMany, findUnique: mockEnrFindUnique, count: mockEnrCount },
    sequence: { update: mockSeqUpdate },
  },
}));

import { priorStepGate, maybeCompleteEnrollment } from "@/lib/sequences/gating";

const steps = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

beforeEach(() => vi.clearAllMocks());

describe("priorStepGate", () => {
  it("proceeds for the first step (no prior)", async () => {
    expect(await priorStepGate("enr1", "s1", steps)).toBe("proceed");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("proceeds when the prior step is SENT", async () => {
    mockFindUnique.mockResolvedValue({ status: "SENT" });
    expect(await priorStepGate("enr1", "s2", steps)).toBe("proceed");
  });

  it("skips when the prior step FAILED", async () => {
    mockFindUnique.mockResolvedValue({ status: "FAILED" });
    expect(await priorStepGate("enr1", "s2", steps)).toBe("skip");
  });

  it("skips when the prior step was SKIPPED (cascade)", async () => {
    mockFindUnique.mockResolvedValue({ status: "SKIPPED" });
    expect(await priorStepGate("enr1", "s3", steps)).toBe("skip");
  });

  it("defers when the prior step is still PENDING", async () => {
    mockFindUnique.mockResolvedValue({ status: "PENDING" });
    expect(await priorStepGate("enr1", "s2", steps)).toBe("defer");
  });

  it("defers when the prior step is QUEUED or SENDING", async () => {
    mockFindUnique.mockResolvedValue({ status: "QUEUED" });
    expect(await priorStepGate("enr1", "s2", steps)).toBe("defer");
    mockFindUnique.mockResolvedValue({ status: "SENDING" });
    expect(await priorStepGate("enr1", "s2", steps)).toBe("defer");
  });

  it("proceeds defensively when the prior execution row is missing", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await priorStepGate("enr1", "s2", steps)).toBe("proceed");
  });
});

describe("maybeCompleteEnrollment", () => {
  it("does nothing while non-terminal executions remain", async () => {
    mockExecCount.mockResolvedValue(2);
    await maybeCompleteEnrollment("enr1");
    expect(mockEnrUpdateMany).not.toHaveBeenCalled();
  });

  it("completes the enrollment when all executions are terminal", async () => {
    mockExecCount.mockResolvedValue(0);
    mockEnrUpdateMany.mockResolvedValue({ count: 1 });
    mockEnrFindUnique.mockResolvedValue({ sequenceId: "seq1" });
    mockEnrCount.mockResolvedValue(3); // other enrollments still active
    await maybeCompleteEnrollment("enr1");
    expect(mockEnrUpdateMany).toHaveBeenCalledWith({
      where: { id: "enr1", status: "ACTIVE" },
      data: { status: "COMPLETED" },
    });
    expect(mockSeqUpdate).not.toHaveBeenCalled();
  });

  it("completes the sequence when no active enrollments remain", async () => {
    mockExecCount.mockResolvedValue(0);
    mockEnrUpdateMany.mockResolvedValue({ count: 1 });
    mockEnrFindUnique.mockResolvedValue({ sequenceId: "seq1" });
    mockEnrCount.mockResolvedValue(0);
    await maybeCompleteEnrollment("enr1");
    expect(mockSeqUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "seq1" }, data: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  it("is a no-op if the enrollment was already non-ACTIVE", async () => {
    mockExecCount.mockResolvedValue(0);
    mockEnrUpdateMany.mockResolvedValue({ count: 0 });
    await maybeCompleteEnrollment("enr1");
    expect(mockEnrFindUnique).not.toHaveBeenCalled();
    expect(mockSeqUpdate).not.toHaveBeenCalled();
  });
});
