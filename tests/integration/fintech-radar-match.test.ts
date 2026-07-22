import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/fintech-radar/match", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return { ...actual, confirmMatches: vi.fn(async () => [{ contactId: "c1", score: 0.8, reason: "fintech CFO" }]) };
});

const findUniqueOrThrow = vi.fn();
const userFindMany = vi.fn();
const contactFindMany = vi.fn();
const matchFindUnique = vi.fn();
const matchCreate = vi.fn();
const matchFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fintechArticle: { findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    contact: { findMany: (...a: unknown[]) => contactFindMany(...a) },
    articleMatch: {
      findUnique: (...a: unknown[]) => matchFindUnique(...a),
      create: (...a: unknown[]) => matchCreate(...a),
      findMany: (...a: unknown[]) => matchFindMany(...a),
    },
  },
}));

import { createMatchesForOrgArticle } from "@/lib/fintech-radar/create-matches";

beforeEach(() => {
  [findUniqueOrThrow, userFindMany, contactFindMany, matchFindUnique, matchCreate, matchFindMany].forEach((m) => m.mockReset());
  findUniqueOrThrow.mockResolvedValue({ id: "a1", title: "T", summary: "S", topics: ["payments"], mentionedCompanies: [], relevantRoles: ["cfo"] });
  userFindMany.mockResolvedValue([{ id: "owner1" }]);
  contactFindMany.mockResolvedValue([{ id: "c1", fullName: "Yossi", currentTitle: "CFO", currentCompany: "Acme", industry: "fintech", headline: "" }]);
  matchFindMany.mockResolvedValue([{ id: "m1" }]);
});

describe("createMatchesForOrgArticle", () => {
  it("creates a match for a confirmed candidate and returns draftable ids", async () => {
    matchFindUnique.mockResolvedValue(null);
    const res = await createMatchesForOrgArticle("org1", "a1");
    expect(matchCreate).toHaveBeenCalledTimes(1);
    expect(res.matchIds).toEqual(["m1"]);
    expect(matchFindMany.mock.calls[0][0].where.ownerId).toEqual({ in: ["owner1"] });
    expect(matchFindMany.mock.calls[0][0].where.articleId).toBe("a1");
  });
  it("is idempotent — skips an already-existing match", async () => {
    matchFindUnique.mockResolvedValue({ id: "existing" });
    const res = await createMatchesForOrgArticle("org1", "a1");
    expect(matchCreate).not.toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
