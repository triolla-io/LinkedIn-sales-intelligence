import { describe, it, expect, vi, beforeEach } from "vitest";

const contactFindMany = vi.hoisted(() => vi.fn());
const spendFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: contactFindMany },
    enrichmentSpend: { findUnique: spendFindUnique },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("selectEnrichableContacts", () => {
  const base = { effectiveUserId: "u1", orgId: "o1", monthlyApolloBudget: 100 };

  it("returns budgetExhausted when no credits remain", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spendFindUnique.mockResolvedValue({ credits: 100 });
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1"] });
    expect(res).toEqual({ budgetExhausted: true });
  });

  it("caps valid ids to remaining credits and counts skipped", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    spendFindUnique.mockResolvedValue({ credits: 98 }); // 2 remaining
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    const res = await selectEnrichableContacts({ ...base, contactIds: ["c1", "c2", "c3"] });
    expect(res).toEqual({ validIds: ["c1", "c2"], skipped: 1, creditsRemaining: 0 });
  });

  it("only counts contacts owned by the user", async () => {
    contactFindMany.mockResolvedValue([{ id: "c1" }]);
    spendFindUnique.mockResolvedValue(null);
    const { selectEnrichableContacts } = await import("@/lib/contacts/enrich-budget");
    await selectEnrichableContacts({ ...base, contactIds: ["c1", "foreign"] });
    expect(contactFindMany.mock.calls[0][0].where.ownerId).toBe("u1");
  });
});
