import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    enrichmentSpend: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
    },
  },
}));

import { brightDataRemaining, addBrightDataSpend, BRIGHTDATA_MONTHLY_LIMIT } from "@/lib/brightdata/budget";

beforeEach(() => vi.clearAllMocks());

describe("brightdata budget", () => {
  it("returns the full limit when nothing spent", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await brightDataRemaining("org1")).toBe(BRIGHTDATA_MONTHLY_LIMIT);
  });

  it("subtracts spent credits and floors at zero", async () => {
    mockFindUnique.mockResolvedValue({ credits: 4990 });
    expect(await brightDataRemaining("org1")).toBe(10);
    mockFindUnique.mockResolvedValue({ credits: 9999 });
    expect(await brightDataRemaining("org1")).toBe(0);
  });

  it("uses a :brightdata-suffixed month key", async () => {
    mockFindUnique.mockResolvedValue(null);
    await brightDataRemaining("org1");
    const where = mockFindUnique.mock.calls[0][0].where;
    expect(where.orgId_month.month).toMatch(/:brightdata$/);
  });

  it("increments spend by the given count", async () => {
    mockUpsert.mockResolvedValue({});
    await addBrightDataSpend("org1", 167);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.create.credits).toBe(167);
    expect(arg.update.credits.increment).toBe(167);
  });
});
