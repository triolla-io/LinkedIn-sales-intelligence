import { describe, it, expect } from "vitest";
import {
  EXTRACT_COMPANY_FN_SOURCE,
  TOP_COMPANY_RESULT_FN_SOURCE,
  companySlugFromUrl,
  companySearchUrl,
} from "../src/lib/resolve-company";

describe("companySlugFromUrl", () => {
  it("extracts the slug from a company URL", () => {
    expect(
      companySlugFromUrl(
        "https://www.linkedin.com/company/acme-corp/about/?x=1",
      ),
    ).toBe("acme-corp");
    expect(
      companySlugFromUrl("https://www.linkedin.com/in/someone"),
    ).toBeNull();
  });
});

describe("companySearchUrl", () => {
  it("builds the companies search URL", () => {
    expect(companySearchUrl("Acme Corp")).toBe(
      "https://www.linkedin.com/search/results/companies/?keywords=Acme%20Corp",
    );
  });
});

describe("EXTRACT_COMPANY_FN_SOURCE (evaluated in jsdom)", () => {
  it("extracts the numeric id from urn:li:fsd_company", () => {
    document.body.innerHTML = `<div data-x="urn:li:fsd_company:1441,xxx"></div><h1>Acme Corp</h1>`;
    const out = eval(EXTRACT_COMPANY_FN_SOURCE) as {
      companyId: string | null;
      resolvedName: string | null;
    };
    expect(out.companyId).toBe("1441");
    expect(out.resolvedName).toBe("Acme Corp");
  });

  it("falls back to voyagerCompanyId and companyId JSON patterns", () => {
    document.body.innerHTML = `<script type="application/json">{"voyagerCompanyId":9021}</script>`;
    expect(
      (eval(EXTRACT_COMPANY_FN_SOURCE) as { companyId: string | null })
        .companyId,
    ).toBe("9021");
    document.body.innerHTML = `<code>{"companyId":77}</code>`;
    expect(
      (eval(EXTRACT_COMPANY_FN_SOURCE) as { companyId: string | null })
        .companyId,
    ).toBe("77");
  });

  it("returns null companyId when no pattern matches", () => {
    document.body.innerHTML = `<p>nothing here</p>`;
    expect(
      (eval(EXTRACT_COMPANY_FN_SOURCE) as { companyId: string | null })
        .companyId,
    ).toBeNull();
  });
});

describe("TOP_COMPANY_RESULT_FN_SOURCE (evaluated in jsdom)", () => {
  it("returns up to 5 distinct /company/ results in order", () => {
    document.body.innerHTML = `
      <ul>
        <li>
          <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
          <p>Software · Tel Aviv</p>
        </li>
        <li>
          <a href="https://www.linkedin.com/company/beta-inc/?x=1">Beta Inc</a>
          <p>Retail</p>
        </li>
        <li>
          <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp dup</a>
        </li>
      </ul>`;
    const out = eval(TOP_COMPANY_RESULT_FN_SOURCE) as Array<{
      companyUrl: string;
      name: string | null;
    }>;
    expect(out.map((c) => c.companyUrl)).toEqual([
      "https://www.linkedin.com/company/acme-corp/",
      "https://www.linkedin.com/company/beta-inc/",
    ]);
    expect(out[0].name).toBe("Acme Corp");
  });

  it("returns an empty array when there are no company links", () => {
    document.body.innerHTML = `<a href="https://www.linkedin.com/in/person">person</a>`;
    expect(eval(TOP_COMPANY_RESULT_FN_SOURCE)).toEqual([]);
  });

  it("caps the result list at 5 candidates", () => {
    document.body.innerHTML =
      "<ul>" +
      [1, 2, 3, 4, 5, 6]
        .map(
          (n) =>
            `<li><a href="https://www.linkedin.com/company/c${n}/">C${n}</a></li>`,
        )
        .join("") +
      "</ul>";
    const out = eval(TOP_COMPANY_RESULT_FN_SOURCE) as Array<{ companyUrl: string }>;
    expect(out).toHaveLength(5);
    expect(out[4].companyUrl).toBe("https://www.linkedin.com/company/c5/");
  });
});

import {
  normalizeCompanyName,
  scoreCompanyMatch,
  pickBestCompany,
  MATCH_THRESHOLD,
} from "../src/lib/resolve-company";

describe("normalizeCompanyName", () => {
  it("lowercases, strips punctuation, and drops geo + corporate stop-tokens", () => {
    expect(normalizeCompanyName("H&M Israel")).toEqual(["h&m"]);
    expect(normalizeCompanyName("Delek Group")).toEqual(["delek"]);
    expect(normalizeCompanyName("Yves Rocher IL")).toEqual(["yves", "rocher"]);
    expect(normalizeCompanyName("King David Mattresses")).toEqual([
      "king",
      "david",
      "mattresses",
    ]);
    expect(normalizeCompanyName("חברת ישראל")).toEqual(["חברת"]);
  });

  it("returns an empty array when only stop-tokens remain", () => {
    expect(normalizeCompanyName("Israel IL")).toEqual([]);
  });
});

describe("scoreCompanyMatch", () => {
  it("scores by fraction of significant requested tokens covered", () => {
    expect(scoreCompanyMatch("LastPrice", "Lastprice")).toBe(1);
    expect(scoreCompanyMatch("H&M Israel", "H&M")).toBe(1);
    expect(scoreCompanyMatch("Delek Israel", "Delek Group")).toBe(1);
    expect(scoreCompanyMatch("King David Mattresses", "King David")).toBeCloseTo(
      2 / 3,
    );
    expect(scoreCompanyMatch("Vardinon", "Some Unrelated Co")).toBe(0);
  });

  it("returns 0 when the requested name has no significant tokens", () => {
    expect(scoreCompanyMatch("Israel IL", "Anything")).toBe(0);
  });

  it("does not let a repeated requested token inflate the denominator", () => {
    // "Delek Delek Energy" → distinct significant tokens {delek, energy}; candidate covers delek only → 1/2
    expect(scoreCompanyMatch("Delek Delek Energy", "Delek")).toBe(0.5);
  });
});

describe("pickBestCompany", () => {
  const c = (companyUrl: string, name: string | null) => ({ companyUrl, name });

  it("picks the highest-scoring candidate at or above the threshold", () => {
    const best = pickBestCompany("Vardinon", [
      c("https://linkedin.com/company/other/", "Other Corp"),
      c("https://linkedin.com/company/vardinon/", "Vardinon"),
    ]);
    expect(best?.companyUrl).toBe("https://linkedin.com/company/vardinon/");
  });

  it("breaks ties toward the earlier (higher-ranked) candidate", () => {
    const best = pickBestCompany("Delek", [
      c("https://linkedin.com/company/delek-group/", "Delek Group"),
      c("https://linkedin.com/company/delek-israel/", "Delek Israel"),
    ]);
    expect(best?.companyUrl).toBe("https://linkedin.com/company/delek-group/");
  });

  it("returns null when the best score is below the threshold", () => {
    expect(
      pickBestCompany("Vardinon", [c("https://linkedin.com/company/x/", "Totally Different")]),
    ).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(pickBestCompany("Vardinon", [])).toBeNull();
  });

  it("falls back to the top-ranked candidate when the requested name is all stop-tokens", () => {
    const best = pickBestCompany("Israel IL", [
      c("https://linkedin.com/company/first/", "First"),
      c("https://linkedin.com/company/second/", "Second"),
    ]);
    expect(best?.companyUrl).toBe("https://linkedin.com/company/first/");
  });

  it("exposes a 0.5 threshold", () => {
    expect(MATCH_THRESHOLD).toBe(0.5);
  });
});
