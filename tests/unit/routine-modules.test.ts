import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindUnique = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockOrgUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockUserFindUniqueOrThrow(...a),
      update: vi.fn(),
    },
    organization: { update: (...a: unknown[]) => mockOrgUpdate(...a) },
  },
}));

import { getRoutineModuleState, setRoutineModule } from "@/lib/routine/modules";

beforeEach(() => vi.clearAllMocks());

describe("routine modules — companySignals", () => {
  it("reports companySignalsEnabled from the org", async () => {
    mockUserFindUnique.mockResolvedValue({
      routineConnectionsEnabled: true,
      org: { jobCheckEnabled: false, companySignalsEnabled: true },
    });
    const state = await getRoutineModuleState("u1");
    expect(state.companySignalsEnabled).toBe(true);
  });

  it("setRoutineModule('companySignals') updates the org", async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({ orgId: "org1" });
    await setRoutineModule("u1", "companySignals", true);
    expect(mockOrgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { companySignalsEnabled: true } });
  });
});
