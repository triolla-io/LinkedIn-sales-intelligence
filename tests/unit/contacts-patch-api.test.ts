import { describe, it, expect } from "vitest";

const EDITABLE_FIELDS = ["email", "phone", "currentTitle", "currentCompany", "location", "headline"] as const;
type EditableField = typeof EDITABLE_FIELDS[number];

function parseEditBody(body: unknown): Partial<Record<EditableField, string | null>> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<Record<EditableField, string | null>> = {};
  let hasField = false;
  for (const key of EDITABLE_FIELDS) {
    if (key in b) {
      const val = b[key];
      if (val !== null && typeof val !== "string") return null;
      patch[key] = val as string | null;
      hasField = true;
    }
  }
  return hasField ? patch : null;
}

function mergeManualFields(existing: string[], added: string[]): string[] {
  return Array.from(new Set([...existing, ...added]));
}

describe("parseEditBody", () => {
  it("accepts email only", () => {
    expect(parseEditBody({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
  });
  it("accepts multiple fields", () => {
    expect(parseEditBody({ email: "a@b.com", phone: "123" })).toEqual({ email: "a@b.com", phone: "123" });
  });
  it("accepts null to clear a field", () => {
    expect(parseEditBody({ email: null })).toEqual({ email: null });
  });
  it("rejects unknown fields only (no known fields present)", () => {
    expect(parseEditBody({ unknownField: "x" })).toBeNull();
  });
  it("rejects non-string non-null value", () => {
    expect(parseEditBody({ email: 123 })).toBeNull();
  });
  it("rejects empty body", () => {
    expect(parseEditBody({})).toBeNull();
  });
  it("rejects non-object", () => {
    expect(parseEditBody(null)).toBeNull();
  });
});

describe("mergeManualFields", () => {
  it("unions existing and new", () => {
    expect(mergeManualFields(["email"], ["phone"])).toEqual(["email", "phone"]);
  });
  it("no duplicates", () => {
    expect(mergeManualFields(["email", "phone"], ["email"])).toEqual(["email", "phone"]);
  });
  it("works from empty", () => {
    expect(mergeManualFields([], ["email"])).toEqual(["email"]);
  });
});
