import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { fintechArticle: { findUnique: (...a: unknown[]) => findUnique(...a), create: (...a: unknown[]) => create(...a) } },
}));

import { upsertArticles } from "@/lib/fintech-radar/persist";

beforeEach(() => { create.mockReset(); findUnique.mockReset(); });

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
