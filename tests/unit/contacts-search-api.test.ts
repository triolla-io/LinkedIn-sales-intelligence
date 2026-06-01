import { describe, it, expect } from "vitest";

// Inline the pure helpers (same pattern as lists-api.test.ts — can't import route files in vitest)

function buildSearchWhere(ownerId: string, q: string, excludeListId?: string) {
  const orClause = q.trim()
    ? [
        { name: { contains: q.trim(), mode: "insensitive" as const } },
        { email: { contains: q.trim(), mode: "insensitive" as const } },
      ]
    : undefined;

  return {
    ownerId,
    ...(orClause ? { OR: orClause } : {}),
    ...(excludeListId
      ? { lists: { none: { listId: excludeListId } } }
      : {}),
  };
}

function parseSearchParams(params: URLSearchParams): {
  q: string;
  excludeListId: string | undefined;
  limit: number;
} {
  const q = params.get("q") ?? "";
  const excludeListId = params.get("excludeListId") ?? undefined;
  const rawLimit = Number(params.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
  return { q, excludeListId, limit };
}

describe("buildSearchWhere", () => {
  it("filters by ownerId only when q is empty", () => {
    expect(buildSearchWhere("u1", "")).toEqual({ ownerId: "u1" });
  });

  it("adds OR clause for name/email when q is provided", () => {
    const w = buildSearchWhere("u1", "alice");
    expect(w).toEqual({
      ownerId: "u1",
      OR: [
        { name: { contains: "alice", mode: "insensitive" } },
        { email: { contains: "alice", mode: "insensitive" } },
      ],
    });
  });

  it("trims whitespace in q", () => {
    const w = buildSearchWhere("u1", "  bob  ");
    expect(w.OR![0]).toEqual({ name: { contains: "bob", mode: "insensitive" } });
  });

  it("excludes list members when excludeListId provided", () => {
    const w = buildSearchWhere("u1", "", "list-99");
    expect(w).toEqual({
      ownerId: "u1",
      lists: { none: { listId: "list-99" } },
    });
  });

  it("combines q and excludeListId", () => {
    const w = buildSearchWhere("u1", "carol", "list-99");
    expect(w.OR).toHaveLength(2);
    expect(w.lists).toEqual({ none: { listId: "list-99" } });
  });
});

describe("parseSearchParams", () => {
  it("returns defaults when params are empty", () => {
    expect(parseSearchParams(new URLSearchParams())).toEqual({
      q: "",
      excludeListId: undefined,
      limit: 20,
    });
  });

  it("parses all params", () => {
    expect(
      parseSearchParams(new URLSearchParams("q=alice&excludeListId=list-1&limit=10"))
    ).toEqual({ q: "alice", excludeListId: "list-1", limit: 10 });
  });

  it("clamps limit to 50", () => {
    expect(parseSearchParams(new URLSearchParams("limit=999")).limit).toBe(50);
  });

  it("falls back to 20 for invalid limit", () => {
    expect(parseSearchParams(new URLSearchParams("limit=abc")).limit).toBe(20);
  });
});
