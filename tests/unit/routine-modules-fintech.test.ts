import { describe, it, expect, vi, beforeEach } from "vitest";

const orgUpdate = vi.fn();
const userFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUniqueOrThrow: (...a: unknown[]) => userFindUniqueOrThrow(...a) },
    organization: { update: (...a: unknown[]) => orgUpdate(...a) },
  },
}));

import { setRoutineModule } from "@/lib/routine/modules";

beforeEach(() => {
  orgUpdate.mockReset();
  userFindUniqueOrThrow.mockReset();
  userFindUniqueOrThrow.mockResolvedValue({ orgId: "org1" });
});

describe("setRoutineModule fintechRadar", () => {
  it("writes fintechRadarEnabled on the org", async () => {
    await setRoutineModule("user1", "fintechRadar", true);
    expect(orgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { fintechRadarEnabled: true } });
  });
});
