import { describe, it, expect } from "vitest";
import { employersOf, matchExistingCompany, type CohortRow } from "@/lib/tech-radar/population";

function row(over: Partial<CohortRow> = {}): CohortRow {
  return {
    id: "c1",
    ownerId: "u1",
    radarInclude: null,
    currentTitle: "CEO",
    currentCompany: "Acme Ltd",
    companyId: null,
    companySize: 120,
    enrichedAt: null,
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    company: null,
    ...over,
  };
}

describe("employersOf", () => {
  it("returns one employer per distinct company name", () => {
    const out = employersOf([row({ id: "a" }), row({ id: "b" })]);
    expect(out).toEqual([{ companyId: null, name: "Acme Ltd", staffCount: 120 }]);
  });

  it("deduplicates case- and whitespace-insensitively but keeps the first spelling", () => {
    const out = employersOf([
      row({ id: "a", currentCompany: "Acme Ltd" }),
      row({ id: "b", currentCompany: "  acme ltd " }),
    ]);
    expect(out).toEqual([{ companyId: null, name: "Acme Ltd", staffCount: 120 }]);
  });

  it("prefers a resolved companyId over the free-text name", () => {
    const out = employersOf([row({ companyId: "co1" })]);
    expect(out).toEqual([{ companyId: "co1", name: "Acme Ltd", staffCount: 120 }]);
  });

  it("snapshots the headcount that put the employer in range", () => {
    const out = employersOf([
      row({ companySize: null, company: { staffCount: 80, industry: null } }),
    ]);
    expect(out[0].staffCount).toBe(80);
  });

  it("treats the same name with and without a companyId as one employer", () => {
    const out = employersOf([
      row({ id: "a", companyId: null }),
      row({ id: "b", companyId: "co1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].companyId).toBe("co1");
  });

  it("upgrades headcount when a later contact at the same employer has one", () => {
    const out = employersOf([
      row({ id: "a", radarInclude: true, companySize: null, company: null }),
      row({ id: "b", companySize: null, company: { staffCount: 80, industry: null } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].staffCount).toBe(80);
  });

  it("skips contacts with no usable employer name", () => {
    expect(employersOf([row({ currentCompany: null }), row({ currentCompany: "   " })])).toEqual([]);
  });

  it("only considers contacts that are in the cohort", () => {
    const out = employersOf([
      row({ id: "a", currentTitle: "Intern", currentCompany: "Excluded Co" }),
      row({ id: "b", currentCompany: "Included Co" }),
    ]);
    expect(out).toEqual([{ companyId: null, name: "Included Co", staffCount: 120 }]);
  });

  it("is deterministic — sorted by normalized name", () => {
    const out = employersOf([
      row({ id: "a", currentCompany: "Zeta" }),
      row({ id: "b", currentCompany: "Alpha" }),
    ]);
    expect(out.map((e) => e.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("matchExistingCompany", () => {
  const existing = [
    { id: "t1", name: "Shlomo Insurance", aliases: ["SHLOMO GROUP", "Shlomo Sixt"] },
    { id: "t2", name: "Delek Group", aliases: [] },
  ];
  const ref = (name: string) => ({ companyId: null, name, staffCount: 100 });

  it("matches on the canonical name, case-insensitively", () => {
    expect(matchExistingCompany(ref("shlomo insurance"), existing)).toBe("t1");
  });

  it("matches on an alias — the case v1 got wrong", () => {
    expect(matchExistingCompany(ref("SHLOMO GROUP"), existing)).toBe("t1");
  });

  it("does not match a different company that merely shares a word", () => {
    expect(matchExistingCompany(ref("Delek US Holdings"), existing)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchExistingCompany(ref("Brand New Co"), existing)).toBeNull();
  });
});
