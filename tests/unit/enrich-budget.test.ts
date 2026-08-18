import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.hoisted(() => vi.fn());
const orgSpendFindUnique = vi.hoisted(() => vi.fn());
const userSpendFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: contactFindMany },
    enrichmentSpend: { findUnique: orgSpendFindUnique },
    userEnrichmentSpend: { findUnique: userSpendFindUnique },
  },
}));

beforeEach(() => vi.clearAllMocks());

/** org pool used / this user's used */
function spend(org: number | null, user: number | null) {
  orgSpendFindUnique.mockResolvedValue(org === null ? null : { credits: org });
  userSpendFindUnique.mockResolvedValue(user === null ? null : { credits: user });
}

describe("selectEnrichableContacts", () => {
  const base = {
    effectiveUserId: "u1",
    orgId: "o1",
    monthlyApolloBudget: 2000,
    perUserMonthlyApolloCredits: 1000,
  };

  it("returns budgetExhausted when the org pool is drained", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spend(2000, 0);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1"] });
    expect(res).toEqual({ budgetExhausted: true, blockedBy: "org" });
  });

  it("returns budgetExhausted when the user hit their own quota but the pool has room", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spend(1000, 1000);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1"] });
    expect(res).toEqual({ budgetExhausted: true, blockedBy: "user" });
  });

  it("caps valid ids to the user's remaining quota and counts skipped", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    spend(0, 998); // pool wide open, but this user has only 2 of their own left
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1", "c2", "c3"] });
    expect(res).toEqual({ validIds: ["c1", "c2"], skipped: 1, creditsRemaining: 0 });
  });

  it("caps to the org pool when the pool is tighter than the user quota", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    spend(1999, 0); // 1 left in the pool; user still has all 1000 of theirs
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1", "c2", "c3"] });
    expect(res).toEqual({ validIds: ["c1"], skipped: 2, creditsRemaining: 0 });
  });

  it("queues everything when both ceilings have plenty of room", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    spend(null, null);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1", "c2"] });
    expect(res).toEqual({ validIds: ["c1", "c2"], skipped: 0, creditsRemaining: 998 });
  });

  it("only counts contacts owned by the user", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spend(null, null);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    await selectEnrichableContacts({ ...base, contactIds: ["c1", "foreign"] });
    expect(contactFindMany.mock.calls[0][0].where.ownerId).toBe("u1");
  });

  it("charges the quota of the effective user, not the org", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spend(null, null);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    await selectEnrichableContacts({ ...base, contactIds: ["c1"] });
    expect(userSpendFindUnique.mock.calls[0][0].where.userId_month.userId).toBe("u1");
  });
});
