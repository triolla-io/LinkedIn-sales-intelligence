import { describe, it, expect } from "vitest";
import { diffContacts } from "@/lib/csv/diff";

describe("diffContacts", () => {
  it("classifies brand-new linkedinUrns as added", () => {
    const existing = new Map<string, { fullName: string; currentTitle: string | null; currentCompany: string | null; companySize: number | null }>();
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.added).toEqual(["urn:1"]);
    expect(result.updated).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it("classifies same name+title+company as unchanged", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.unchanged).toEqual(["urn:1"]);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("classifies same urn but different title as updated", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CTO", currentCompany: "Acme", companySize: null }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.updated).toEqual(["urn:1"]);
  });

  it("classifies existing urns missing from incoming as removed", () => {
    const existing = new Map([
      ["urn:1", { fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null }],
      ["urn:2", { fullName: "Bob",   currentTitle: "CFO", currentCompany: "Beta",  companySize: null }],
    ]);
    const incoming = [
      { linkedinUrn: "urn:1", fullName: "Alice", currentTitle: "CEO", currentCompany: "Acme", companySize: null },
    ];
    const result = diffContacts(existing, incoming);
    expect(result.removed).toEqual(["urn:2"]);
    expect(result.unchanged).toEqual(["urn:1"]);
  });

  it("handles empty inputs", () => {
    expect(diffContacts(new Map(), [])).toEqual({
      added: [], updated: [], removed: [], unchanged: [],
    });
  });
});
