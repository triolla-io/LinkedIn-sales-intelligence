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
  it("picks the first /company/ result card", () => {
    document.body.innerHTML = `
      <ul><li>
        <a href="https://www.linkedin.com/company/acme-corp/">Acme Corp</a>
        <p>Software · Tel Aviv</p>
      </li></ul>`;
    const out = eval(TOP_COMPANY_RESULT_FN_SOURCE) as {
      companyUrl: string;
      name: string | null;
    } | null;
    expect(out?.companyUrl).toBe("https://www.linkedin.com/company/acme-corp/");
  });

  it("returns null when there are no company links", () => {
    document.body.innerHTML = `<a href="https://www.linkedin.com/in/person">person</a>`;
    expect(eval(TOP_COMPANY_RESULT_FN_SOURCE)).toBeNull();
  });
});
