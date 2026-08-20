import { describe, it, expect } from "vitest";
import { judgeCohort, tallyCohort, type CohortContact } from "@/lib/tech-radar/cohort";

function contact(over: Partial<CohortContact> = {}): CohortContact {
  return {
    id: "c1",
    radarInclude: null,
    currentTitle: "CEO",
    companySize: 120,
    enrichedAt: "2026-08-01T00:00:00.000Z",
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    company: null,
    ...over,
  };
}

describe("judgeCohort", () => {
  it("includes a C-level at a 50-200 person company", () => {
    expect(judgeCohort(contact())).toEqual({ included: true, reason: "cohort" });
  });

  it("honours an explicit opt-in even outside the cohort", () => {
    const v = judgeCohort(contact({ radarInclude: true, currentTitle: "Analyst", companySize: 90000 }));
    expect(v).toEqual({ included: true, reason: "opt_in" });
  });

  it("honours an explicit opt-out even inside the cohort", () => {
    expect(judgeCohort(contact({ radarInclude: false }))).toEqual({
      included: false,
      reason: "opt_out",
    });
  });

  it("excludes a non-C-level title", () => {
    expect(judgeCohort(contact({ currentTitle: "VP Marketing" }))).toEqual({
      included: false,
      reason: "not_clevel",
    });
  });

  it("does not treat a Hebrew deputy title as C-level", () => {
    expect(judgeCohort(contact({ currentTitle: 'סמנכ"ל כספים' })).reason).toBe("not_clevel");
  });

  it("reports an unknown headcount as its own reason, never as a size failure", () => {
    const v = judgeCohort(contact({ companySize: null, company: null }));
    expect(v).toEqual({ included: false, reason: "size_unknown" });
  });

  it("falls back to the LinkedIn staffCount when Apollo has no size", () => {
    const v = judgeCohort(
      contact({ companySize: null, company: { staffCount: 80, industry: null } }),
    );
    expect(v).toEqual({ included: true, reason: "cohort" });
  });

  it("excludes companies below and above the band, inclusive at the edges", () => {
    expect(judgeCohort(contact({ companySize: 49 })).reason).toBe("size_out_of_range");
    expect(judgeCohort(contact({ companySize: 50 })).included).toBe(true);
    expect(judgeCohort(contact({ companySize: 200 })).included).toBe(true);
    expect(judgeCohort(contact({ companySize: 201 })).reason).toBe("size_out_of_range");
  });

  it("checks seniority before size, so size_unknown only ever counts C-levels", () => {
    const v = judgeCohort(contact({ currentTitle: "Intern", companySize: null }));
    expect(v.reason).toBe("not_clevel");
  });
});

describe("tallyCohort", () => {
  it("counts every contact into exactly one bucket", () => {
    const counts = tallyCohort([
      contact({ id: "a" }),
      contact({ id: "b", radarInclude: true, currentTitle: "Analyst" }),
      contact({ id: "c", radarInclude: false }),
      contact({ id: "d", currentTitle: "Intern" }),
      contact({ id: "e", companySize: null }),
      contact({ id: "f", companySize: 5000 }),
    ]);
    expect(counts.total).toBe(6);
    expect(counts.cohort).toBe(1);
    expect(counts.opt_in).toBe(1);
    expect(counts.opt_out).toBe(1);
    expect(counts.not_clevel).toBe(1);
    expect(counts.size_unknown).toBe(1);
    expect(counts.size_out_of_range).toBe(1);
    const summed =
      counts.cohort + counts.opt_in + counts.opt_out +
      counts.not_clevel + counts.size_unknown + counts.size_out_of_range;
    expect(summed).toBe(counts.total);
  });
});
