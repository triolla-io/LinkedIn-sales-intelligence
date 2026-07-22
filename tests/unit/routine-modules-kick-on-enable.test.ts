import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindUniqueOrThrow = vi.fn();
const mockOrgUpdate = vi.fn();
const mockInngestSend = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUniqueOrThrow: (...a: unknown[]) => mockUserFindUniqueOrThrow(...a), update: vi.fn() },
    organization: { update: (...a: unknown[]) => mockOrgUpdate(...a) },
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: (...a: unknown[]) => mockInngestSend(...a) },
}));

import { setRoutineModule } from "@/lib/routine/modules";

beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindUniqueOrThrow.mockResolvedValue({ orgId: "org1" });
});

describe("routine modules — kick-on-enable", () => {
  it("enabling companySignals dispatches company.signals.enabled for the org", async () => {
    await setRoutineModule("u1", "companySignals", true);
    expect(mockInngestSend).toHaveBeenCalledWith({ name: "company.signals.enabled", data: { orgId: "org1" } });
  });

  it("enabling fintechRadar dispatches fintech.radar.enabled for the org", async () => {
    await setRoutineModule("u1", "fintechRadar", true);
    expect(mockInngestSend).toHaveBeenCalledWith({ name: "fintech.radar.enabled", data: { orgId: "org1" } });
  });

  it("disabling does NOT dispatch a kick event", async () => {
    await setRoutineModule("u1", "companySignals", false);
    await setRoutineModule("u1", "fintechRadar", false);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });
});
