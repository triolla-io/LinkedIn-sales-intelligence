import { describe, it, expect } from "vitest";

function buildEnrichPatch(
  result: { email?: string | null; phone?: string | null; companySize?: number | null; currentCompany?: string | null; industry?: string | null },
  contact: { currentCompany?: string | null; industry?: string | null; manualFields: string[] }
): Record<string, unknown> {
  const protected_ = new Set(contact.manualFields);
  const patch: Record<string, unknown> = {};
  if (!protected_.has("email") && result.email) patch.email = result.email;
  if (!protected_.has("phone") && result.phone) patch.phone = result.phone;
  if (result.companySize) patch.companySize = result.companySize;
  if (!protected_.has("currentCompany") && result.currentCompany && !contact.currentCompany)
    patch.currentCompany = result.currentCompany;
  if (!protected_.has("industry") && result.industry && !contact.industry)
    patch.industry = result.industry;
  patch.enrichedAt = "SET";
  patch.enrichmentSource = "apollo";
  return patch;
}

describe("buildEnrichPatch", () => {
  it("applies all fields when manualFields is empty", () => {
    const patch = buildEnrichPatch(
      { email: "a@b.com", phone: "123", companySize: 50 },
      { manualFields: [] }
    );
    expect(patch.email).toBe("a@b.com");
    expect(patch.phone).toBe("123");
    expect(patch.companySize).toBe(50);
  });

  it("skips email when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { email: "apollo@b.com", phone: "123" },
      { manualFields: ["email"] }
    );
    expect(patch.email).toBeUndefined();
    expect(patch.phone).toBe("123");
  });

  it("skips phone when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { email: "a@b.com", phone: "apollo-phone" },
      { manualFields: ["phone"] }
    );
    expect(patch.phone).toBeUndefined();
    expect(patch.email).toBe("a@b.com");
  });

  it("skips currentCompany when it is in manualFields", () => {
    const patch = buildEnrichPatch(
      { currentCompany: "Apollo Corp" },
      { currentCompany: null, manualFields: ["currentCompany"] }
    );
    expect(patch.currentCompany).toBeUndefined();
  });

  it("always sets enrichedAt and enrichmentSource", () => {
    const patch = buildEnrichPatch({}, { manualFields: [] });
    expect(patch.enrichedAt).toBe("SET");
    expect(patch.enrichmentSource).toBe("apollo");
  });
});
