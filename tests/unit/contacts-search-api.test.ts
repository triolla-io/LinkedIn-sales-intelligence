import { describe, it, expect } from "vitest";

// Inline the pure helpers (same pattern as lists-api.test.ts — can't import route files in vitest)

const SEARCH_FIELDS = [
  "fullName",
  "email",
  "currentCompany",
  "currentTitle",
  "hebrewFirstName",
] as const;

function buildSearchWhere(ownerId: string, q: string, excludeListId?: string) {
  const tokens = q.trim().split(/\s+/).filter(Boolean);

  const andClause = tokens.length
    ? tokens.map((token) => ({
        OR: SEARCH_FIELDS.map((field) => ({
          [field]: { contains: token, mode: "insensitive" as const },
        })),
      }))
    : undefined;

  return {
    ownerId,
    ...(andClause ? { AND: andClause } : {}),
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

  it("adds an AND clause matching the token across all search fields", () => {
    const w = buildSearchWhere("u1", "alice");
    expect(w).toEqual({
      ownerId: "u1",
      AND: [
        {
          OR: [
            { fullName: { contains: "alice", mode: "insensitive" } },
            { email: { contains: "alice", mode: "insensitive" } },
            { currentCompany: { contains: "alice", mode: "insensitive" } },
            { currentTitle: { contains: "alice", mode: "insensitive" } },
            { hebrewFirstName: { contains: "alice", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("creates one AND entry per whitespace-separated token", () => {
    const w = buildSearchWhere("u1", "alice acme");
    expect(w.AND).toHaveLength(2);
    expect(w.AND![0].OR[0]).toEqual({ fullName: { contains: "alice", mode: "insensitive" } });
    expect(w.AND![1].OR[0]).toEqual({ fullName: { contains: "acme", mode: "insensitive" } });
  });

  it("trims and collapses surrounding whitespace in q", () => {
    const w = buildSearchWhere("u1", "  bob  ");
    expect(w.AND).toHaveLength(1);
    expect(w.AND![0].OR[0]).toEqual({ fullName: { contains: "bob", mode: "insensitive" } });
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
    expect(w.AND).toHaveLength(1);
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
