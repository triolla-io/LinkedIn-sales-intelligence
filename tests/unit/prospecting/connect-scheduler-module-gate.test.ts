import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockRunUpdateMany = vi.fn();
const mockRunFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockCrFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { updateMany: mockRunUpdateMany, findUnique: mockRunFindUnique },
    user: { findUnique: mockUserFindUnique },
    connectionRequest: { findFirst: mockCrFindFirst, updateMany: vi.fn(), count: vi.fn() },
    extensionTask: { findFirst: vi.fn(), create: vi.fn() },
    prospectingEvent: { create: vi.fn() },
  },
}));

const RUN = { id: "r1", ownerId: "u1", status: "RUNNING", dailyCap: 15, weeklyCap: 100 };

describe("queueNextConnect — connections module gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunUpdateMany.mockResolvedValue({ count: 1 });
    mockRunFindUnique.mockResolvedValue(RUN);
  });

  it("owner disabled the module → releases the slot and queues nothing", async () => {
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: false });
    const { queueNextConnect } = await import("@/lib/prospecting/connect-scheduler");

    const result = await queueNextConnect("r1");

    expect(result).toBeNull();
    expect(mockCrFindFirst).not.toHaveBeenCalled();
    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { connectInFlight: false },
    });
  });

  it("owner has the module enabled → proceeds to candidate selection", async () => {
    mockUserFindUnique.mockResolvedValue({ routineConnectionsEnabled: true });
    mockCrFindFirst.mockResolvedValue(null);
    const { queueNextConnect } = await import("@/lib/prospecting/connect-scheduler");

    const result = await queueNextConnect("r1");

    expect(result).toBeNull();
    expect(mockCrFindFirst).toHaveBeenCalled();
  });
});
