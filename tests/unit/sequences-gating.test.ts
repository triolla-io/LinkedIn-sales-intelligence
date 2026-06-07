import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sequenceStepExecution: { findUnique: mockFindUnique, count: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    sequence: { update: vi.fn() },
  },
}));

import { priorStepGate } from "@/lib/sequences/gating";

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
