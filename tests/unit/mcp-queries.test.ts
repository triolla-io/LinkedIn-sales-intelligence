import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.hoisted(() => vi.fn());
const contactFindFirst = vi.hoisted(() => vi.fn());
const runFindFirst = vi.hoisted(() => vi.fn());
const crGroupBy = vi.hoisted(() => vi.fn());
const crFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: contactFindMany, findFirst: contactFindFirst },
    prospectingRun: { findFirst: runFindFirst, findMany: vi.fn() },
    connectionRequest: { groupBy: crGroupBy, findMany: crFindMany },
    sequence: { findMany: vi.fn(), findFirst: vi.fn() },
    campaign: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const ctx = { userId: "u1", orgId: "o1", email: "ariel@triolla.io" };
beforeEach(() => vi.clearAllMocks());

describe("mcp queries", () => {
  it("searchContacts scopes by ownerId and returns count", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1", fullName: "A" }]);
    const { searchContacts } = await import("@/lib/mcp/queries");
    const res = await searchContacts(ctx, { query: "vp", limit: 20 });
    expect(res).toEqual({ count: 1, contacts: [{ id: "c1", fullName: "A" }] });
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe("u1");
    expect(where.removedAt).toBeNull();
  });

  it("getContact throws not_found when the contact is not the user's", async () => {
    contactFindFirst.mockResolvedValue(null);
    const { getContact } = await import("@/lib/mcp/queries");
    await expect(getContact(ctx, { contactId: "c9" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("getRunStatus throws not_found for a foreign run", async () => {
    runFindFirst.mockResolvedValue(null);
    const { getRunStatus } = await import("@/lib/mcp/queries");
    await expect(getRunStatus(ctx, { runId: "r9" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("connectionStats computes acceptance rate", async () => {
    crGroupBy.mockResolvedValue([
      { status: "SENT", _count: 6 },
      { status: "ACCEPTED", _count: 4 },
    ]);
    const { connectionStats } = await import("@/lib/mcp/queries");
    const res = await connectionStats(ctx, { days: 7 });
    expect(res.acceptanceRate).toBe(40);
    expect(res.counts).toEqual({ SENT: 6, ACCEPTED: 4 });
  });
});
