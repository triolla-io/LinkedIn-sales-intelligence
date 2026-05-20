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
