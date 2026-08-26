import { describe, it, expect } from "vitest";

import { runFixtures, FIXTURES, type ProposedAxis, type ProposedDomain } from "@/lib/tech-radar/rebuild-fixtures";

/**
 * These fixtures come from the 2026-08-26 feedback on the first message the system ever
 * sent. They are KEYWORD checks and they cut both ways:
 *   - "חידוש התשתית הבנקאית" passes the no-core-systems check while being the same
 *     CTO-lens mistake.
 *   - "כלל ביטוח דיגיטלי" fails the insurtech check while arguably being right.
 *
 * So the reporting must never say PASS. Green here means "the known mistake was not
 * found" — a smoke test that does not replace a human reading the axes.
 */
const axis = (label: string, rationale = "כי הוא מחזיק את החלטת X", queries: string[] = ["q"]): ProposedAxis => ({
  label,
  rationale,
  queries,
});

describe("runFixtures", () => {
  it("reports 'the known mistake was not found' rather than PASS", () => {
    const res = runFixtures("elinor-levinson-gafni", [axis("מוצרי מתחרים בריטייל הבנקאי")]);
    const clean = res.checks.filter((c) => c.clean);
    expect(clean.length).toBeGreaterThan(0);
    expect(clean[0].verdict).toBe("לא נמצאה הטעות הידועה");
    expect(JSON.stringify(res)).not.toContain("PASS");
  });

  it("names the known mistake when it IS found", () => {
    const res = runFixtures("elinor-levinson-gafni", [axis("מודרניזציה של מערכות הליבה בבנקינג")]);
    const core = res.checks.find((c) => c.name === "no core-systems axis");
    expect(core?.clean).toBe(false);
    expect(core?.verdict).toBe("הטעות הידועה נמצאה");
  });

  it("flags an expectation that is missing entirely", () => {
    // Elinor must GAIN a competitor-products axis, not merely lose the core one.
    const res = runFixtures("elinor-levinson-gafni", [axis("חוויית לקוח דיגיטלית")]);
    const wanted = res.checks.find((c) => c.name === "competitor-products-in-retail axis");
    expect(wanted?.clean).toBe(false);
    expect(wanted?.verdict).toBe("הציר המצופה לא נמצא");
  });

  it("searches the rationale and the queries, not only the label", () => {
    // The brain may name the competitor in a query rather than in the label.
    const res = runFixtures("gil--tamir", [axis("דיסראפציה בענף", "כי הם לוחצים", ["Lemonade insurance launch"])]);
    const insurtech = res.checks.find((c) => c.name === "insurtech-to-catch axis");
    expect(insurtech?.clean).toBe(true);
  });

  it("returns nothing for a person with no fixtures", () => {
    expect(runFixtures("someone-else", [axis("x")]).checks).toEqual([]);
  });

  it("erez rachmil: names the missing subject when his title produced no FOUND domain at all", () => {
    // Erez's slug fixture set is the one this task adds a domainsOnly check to. With no
    // domains passed (the default), the check must fail exactly like a missing axis
    // fails — not silently pass because nobody looked.
    const res = runFixtures("erezrachmil", [axis("ניהול נתונים ותשתית ענן")]);
    const titleDomains = res.checks.find((c) => c.name === "full title parsed as FOUND domains");
    expect(titleDomains?.clean).toBe(false);
    expect(titleDomains?.verdict).toBe("הציר המצופה לא נמצא");
  });

  it("erez rachmil: a FOUND domain from his title satisfies the check; a DERIVED one does not", () => {
    const derivedOnly: ProposedDomain[] = [
      { domain: "אבטחת מידע ארגונית", kind: "derived", source: null },
    ];
    const derivedRes = runFixtures("erezrachmil", [axis("x")], derivedOnly);
    expect(derivedRes.checks.find((c) => c.name === "full title parsed as FOUND domains")?.clean).toBe(false);

    const foundOne: ProposedDomain[] = [
      { domain: "Chief Information Officer", kind: "found", source: "title" },
      { domain: "אבטחת מידע ארגונית", kind: "derived", source: null },
    ];
    const foundRes = runFixtures("erezrachmil", [axis("x")], foundOne);
    const check = foundRes.checks.find((c) => c.name === "full title parsed as FOUND domains");
    expect(check?.clean).toBe(true);
    expect(check?.matched).toEqual(["Chief Information Officer"]);
  });

  it("covers exactly the four people from the feedback session", () => {
    expect(FIXTURES.map((f) => f.slug).sort()).toEqual([
      "elinor-levinson-gafni",
      "erezrachmil",
      "gil--tamir",
      "pazit-garfinkel",
    ]);
  });
});
