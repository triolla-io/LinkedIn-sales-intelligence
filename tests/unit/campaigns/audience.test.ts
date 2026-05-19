import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      contact: { findMany: vi.fn() },
    },
  };
});

import { resolveAudience } from "@/lib/campaigns/audience";
import { prisma } from "@/lib/prisma";

describe("resolveAudience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves by explicit contactIds", async () => {
    const mockFindMany = vi.mocked(prisma.contact.findMany);
    mockFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }] as any);
    const result = await resolveAudience("user1", { contactIds: ["c1", "c2"] });
    expect(result).toEqual(["c1", "c2"]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: "user1" }) })
    );
  });

  it("resolves by filter with companySizeMin and companySizeMax", async () => {
    const mockFindMany = vi.mocked(prisma.contact.findMany);
    mockFindMany.mockResolvedValue([{ id: "c1" }] as any);
    const result = await resolveAudience("user1", { filter: { companySizeMin: 10, companySizeMax: 300 } });
    expect(result).toEqual(["c1"]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companySize: expect.objectContaining({ gte: 10, lte: 300 }) }),
      })
    );
  });

  it("returns empty array when nothing matches", async () => {
    const mockFindMany = vi.mocked(prisma.contact.findMany);
    mockFindMany.mockResolvedValue([]);
    const result = await resolveAudience("user1", { filter: {} });
    expect(result).toEqual([]);
  });
});
