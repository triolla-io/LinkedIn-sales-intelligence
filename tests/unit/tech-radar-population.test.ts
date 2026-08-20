import { describe, it, expect } from "vitest";
import { employersOf, countNoEmployer, matchExistingCompany, type CohortRow } from "@/lib/tech-radar/population";

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
    expect(out).toEqual([{ companyId: null, name: "Acme Ltd", staffCount: 120, website: null }]);
  });

  it("deduplicates case- and whitespace-insensitively but keeps the first spelling", () => {
    const out = employersOf([
      row({ id: "a", currentCompany: "Acme Ltd" }),
      row({ id: "b", currentCompany: "  acme ltd " }),
    ]);
    expect(out).toEqual([{ companyId: null, name: "Acme Ltd", staffCount: 120, website: null }]);
  });

  it("prefers a resolved companyId over the free-text name", () => {
    const out = employersOf([row({ companyId: "co1" })]);
    expect(out).toEqual([{ companyId: "co1", name: "Acme Ltd", staffCount: 120, website: null }]);
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

  // The mirror of the test above. On its own, "upgrades headcount..." also
  // passes against a buggy implementation that assigns unconditionally
  // (dropping the `existing.staffCount === null` guard) — a:null, b:80 ends up
  // 80 either way. This order is the one that only the guarded implementation
  // gets right: an unconditional assignment would let the later, employer-less
  // contact stomp the good value back to null.
  it("keeps the earlier headcount snapshot when a later contact at the same employer has none", () => {
    const out = employersOf([
      row({ id: "a", companySize: null, company: { staffCount: 80, industry: null } }),
      // radarInclude: true forces row b into the cohort despite having no size data at
      // all — without this it would be excluded as size_unknown and never reach the
      // merge branch, making the test pass vacuously regardless of the guard.
      row({ id: "b", radarInclude: true, companySize: null, company: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].staffCount).toBe(80);
  });

  // Same shape of gap as the headcount pair above: the existing companyId test
  // only tries null-then-resolved. This is the reverse order, and it is the one
  // an unconditional "always take this row's companyId" implementation gets wrong.
  it("keeps a resolved companyId when a later contact at the same employer has none", () => {
    const out = employersOf([
      row({ id: "a", companyId: "co1" }),
      row({ id: "b", companyId: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].companyId).toBe("co1");
  });

  it("carries the employer's website when the linked company has one", () => {
    const out = employersOf([row({ company: { staffCount: 80, industry: null, website: "https://acme.example" } })]);
    expect(out[0].website).toBe("https://acme.example");
  });

  it("upgrades the website when a later contact at the same employer has one", () => {
    const out = employersOf([
      row({ id: "a", company: null }),
      row({ id: "b", company: { staffCount: null, industry: null, website: "https://acme.example" } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].website).toBe("https://acme.example");
  });

  it("keeps the earlier website and does not let a later contact erase it", () => {
    const out = employersOf([
      row({ id: "a", company: { staffCount: null, industry: null, website: "https://acme.example" } }),
      row({ id: "b", company: null }),
    ]);
    expect(out[0].website).toBe("https://acme.example");
  });

  it("has no website when nothing supplies one", () => {
    const out = employersOf([row()]);
    expect(out[0].website).toBeNull();
  });

  it("still excludes contacts with no usable employer name from the employer list, and counts them separately", () => {
    const rows = [row({ id: "a", currentCompany: null }), row({ id: "b", currentCompany: "   " })];
    expect(employersOf(rows)).toEqual([]);
    expect(countNoEmployer(rows)).toBe(2);
  });

  it("does not count a non-cohort contact's missing employer name as noEmployer", () => {
    const rows = [row({ currentTitle: "Intern", currentCompany: null })];
    expect(countNoEmployer(rows)).toBe(0);
  });

  it("only considers contacts that are in the cohort", () => {
    const out = employersOf([
      row({ id: "a", currentTitle: "Intern", currentCompany: "Excluded Co" }),
      row({ id: "b", currentCompany: "Included Co" }),
    ]);
    expect(out).toEqual([{ companyId: null, name: "Included Co", staffCount: 120, website: null }]);
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
  const ref = (name: string) => ({ companyId: null, name, staffCount: 100, website: null });

  it("matches on the canonical name, case-insensitively", () => {
    expect(matchExistingCompany(ref("shlomo insurance"), existing)).toBe("t1");
  });

  it("matches on an alias — the case v1 got wrong", () => {
    expect(matchExistingCompany(ref("SHLOMO GROUP"), existing)).toBe("t1");
  });

  it("does not match when the tracked name is a substring of the probe (v1's actual bug)", () => {
    // v1 matched with SQL `contains` and the tracked name as the needle: a row
    // named "Delek" matched a contact whose employer read "Delek US Holdings".
    const trackedShort = [{ id: "t3", name: "Delek", aliases: [] }];
    expect(matchExistingCompany(ref("Delek US Holdings"), trackedShort)).toBeNull();
  });

  it("does not match when the probe is a substring of the tracked name", () => {
    const trackedLong = [{ id: "t4", name: "Delek US Holdings", aliases: [] }];
    expect(matchExistingCompany(ref("Delek"), trackedLong)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchExistingCompany(ref("Brand New Co"), existing)).toBeNull();
  });
});
