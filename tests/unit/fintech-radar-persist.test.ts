import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fintechArticle: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import { upsertArticles, findDispatchableArticleIds } from "@/lib/fintech-radar/persist";

beforeEach(() => { create.mockReset(); findUnique.mockReset(); findMany.mockReset(); });

describe("upsertArticles", () => {
  it("creates new articles and returns their ids, skipping existing ones", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "existing" });
    create.mockResolvedValueOnce({ id: "new1" });
    const ids = await upsertArticles([
      { title: "A", url: "https://x.com/a", summary: "s", topics: [], mentionedCompanies: [], relevantRoles: [], publishedAt: "2026-07-20" },
      { title: "B", url: "https://x.com/b", summary: "s", topics: [], mentionedCompanies: [], relevantRoles: [], publishedAt: null },
    ]);
    expect(ids).toEqual(["new1"]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("findDispatchableArticleIds", () => {
  it("queries articles created since the cutoff with no matches, and returns their ids", async () => {
    findMany.mockResolvedValueOnce([{ id: "a1" }, { id: "a2" }]);
    const since = Date.now() - 1000;
    const ids = await findDispatchableArticleIds(since);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.matches).toEqual({ none: {} });
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
    expect(arg.where.createdAt.gte.getTime()).toBe(since);
    expect(ids).toEqual(["a1", "a2"]);
  });
});
