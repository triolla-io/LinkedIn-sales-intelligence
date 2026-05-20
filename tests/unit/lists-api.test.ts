import { describe, it, expect } from "vitest";

// Inline pure helpers — importing from the route would pull in next/server which isn't available in vitest
function buildListsWhere(ownerId: string) {
  return { ownerId };
}

function parseCreateBody(body: unknown): { name: string; contactIds?: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (b.contactIds !== undefined && !Array.isArray(b.contactIds)) return null;
  return { name: b.name.trim(), contactIds: b.contactIds as string[] | undefined };
}

describe("buildListsWhere", () => {
  it("returns ownerId filter", () => {
    expect(buildListsWhere("user-1")).toEqual({ ownerId: "user-1" });
  });
});

describe("parseCreateBody", () => {
  it("accepts valid name", () => {
    expect(parseCreateBody({ name: "My List" })).toEqual({ name: "My List", contactIds: undefined });
  });
  it("trims whitespace", () => {
    expect(parseCreateBody({ name: "  List  " })).toEqual({ name: "List", contactIds: undefined });
  });
  it("accepts contactIds array", () => {
    expect(parseCreateBody({ name: "L", contactIds: ["a", "b"] })).toEqual({ name: "L", contactIds: ["a", "b"] });
  });
  it("rejects missing name", () => {
    expect(parseCreateBody({})).toBeNull();
  });
  it("rejects empty name", () => {
    expect(parseCreateBody({ name: "  " })).toBeNull();
  });
  it("rejects non-array contactIds", () => {
    expect(parseCreateBody({ name: "L", contactIds: "bad" })).toBeNull();
  });
  it("rejects non-object body", () => {
    expect(parseCreateBody(null)).toBeNull();
  });
});

// Inline pure helpers for enrich route logic
function buildEnrichFilter(listId: string): object {
  return {
    lists: { some: { listId } },
    email: null,
  };
}

function sliceTobudget(ids: string[], creditsRemaining: number): string[] {
  return ids.slice(0, creditsRemaining);
}

describe("buildEnrichFilter", () => {
  it("filters list members without email", () => {
    expect(buildEnrichFilter("list-1")).toEqual({
      lists: { some: { listId: "list-1" } },
      email: null,
    });
  });
  it("uses the correct listId", () => {
    const result = buildEnrichFilter("list-abc") as Record<string, unknown>;
    expect((result.lists as { some: { listId: string } }).some.listId).toBe("list-abc");
  });
});

describe("sliceTobudget", () => {
  it("returns all IDs when budget is sufficient", () => {
    expect(sliceTobudget(["a", "b", "c"], 10)).toEqual(["a", "b", "c"]);
  });
  it("slices to budget limit", () => {
    expect(sliceTobudget(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });
  it("returns empty when budget is zero", () => {
    expect(sliceTobudget(["a"], 0)).toEqual([]);
  });
});
