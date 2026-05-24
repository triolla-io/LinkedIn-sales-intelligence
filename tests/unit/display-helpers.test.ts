import { describe, it, expect } from "vitest";

// ── inline type + function for TDD ────────────────────────────────────────────
interface ContactForDisplay {
  companySize?: number | null;
  enrichedAt?: string | null;
  lastSyncedAt: string;
  company?: { staffCount: number | null; industry: string | null } | null;
  industry?: string | null;
  currentCompany?: string | null;
}

function displayCompanySize(c: ContactForDisplay): {
  value: number | null;
  source: "apollo" | "linkedin";
} {
  const apolloAt = c.enrichedAt ? new Date(c.enrichedAt).getTime() : 0;
  const linkedinAt = c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0;
  if (c.companySize && apolloAt >= linkedinAt) {
    return { value: c.companySize, source: "apollo" };
  }
  if (c.company?.staffCount) {
    return { value: c.company.staffCount, source: "linkedin" };
  }
  return { value: c.companySize || null, source: "apollo" };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("displayCompanySize", () => {
  it("prefers apollo companySize when enrichedAt is newer than lastSyncedAt", () => {
    const result = displayCompanySize({
      companySize: 250,
      enrichedAt: "2026-05-20T12:00:00Z",
      lastSyncedAt: "2026-05-18T10:00:00Z",
      company: { staffCount: 5000, industry: null },
    });
    expect(result.value).toBe(250);
    expect(result.source).toBe("apollo");
  });

  it("prefers apollo companySize when enrichedAt equals lastSyncedAt", () => {
    const ts = "2026-05-20T12:00:00Z";
    const result = displayCompanySize({
      companySize: 300,
      enrichedAt: ts,
      lastSyncedAt: ts,
      company: { staffCount: 5000, industry: null },
    });
    expect(result.value).toBe(300);
    expect(result.source).toBe("apollo");
  });

  it("falls back to company.staffCount when lastSyncedAt is newer than enrichedAt", () => {
    const result = displayCompanySize({
      companySize: 250,
      enrichedAt: "2026-05-10T10:00:00Z",
      lastSyncedAt: "2026-05-20T12:00:00Z",
      company: { staffCount: 5000, industry: null },
    });
    expect(result.value).toBe(5000);
    expect(result.source).toBe("linkedin");
  });

  it("falls back to company.staffCount when enrichedAt is null", () => {
    const result = displayCompanySize({
      companySize: 250,
      enrichedAt: null,
      lastSyncedAt: "2026-05-20T12:00:00Z",
      company: { staffCount: 5000, industry: null },
    });
    expect(result.value).toBe(5000);
    expect(result.source).toBe("linkedin");
  });

  it("returns apollo companySize when company is null and enrichedAt is set", () => {
    const result = displayCompanySize({
      companySize: 150,
      enrichedAt: "2026-05-20T12:00:00Z",
      lastSyncedAt: "2026-05-18T10:00:00Z",
      company: null,
    });
    expect(result.value).toBe(150);
    expect(result.source).toBe("apollo");
  });

  it("returns null when both companySize and company.staffCount are absent", () => {
    const result = displayCompanySize({
      companySize: null,
      enrichedAt: null,
      lastSyncedAt: "2026-05-20T12:00:00Z",
      company: null,
    });
    expect(result.value).toBeNull();
  });

  it("returns null when companySize is 0 (falsy) and no staffCount", () => {
    const result = displayCompanySize({
      companySize: 0,
      enrichedAt: "2026-05-20T12:00:00Z",
      lastSyncedAt: "2026-05-18T10:00:00Z",
      company: null,
    });
    expect(result.value).toBeNull();
  });

  it("uses company.staffCount when companySize absent even though enrichedAt is newer", () => {
    const result = displayCompanySize({
      companySize: null,
      enrichedAt: "2026-05-22T12:00:00Z",
      lastSyncedAt: "2026-05-18T10:00:00Z",
      company: { staffCount: 1000, industry: "Software" },
    });
    expect(result.value).toBe(1000);
    expect(result.source).toBe("linkedin");
  });
});
