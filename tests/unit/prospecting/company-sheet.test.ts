import { describe, it, expect } from "vitest";
import {
  normalizeCompanyLinkedinUrl,
  companyDedupKey,
  companyInputToParsed,
  parseCompanyRows,
} from "@/lib/prospecting/company-sheet";

describe("normalizeCompanyLinkedinUrl", () => {
  it("normalizes company URLs to canonical https://www.linkedin.com/company/<slug>", () => {
    for (const raw of [
      "https://www.linkedin.com/company/Acme-Corp/",
      "https://il.linkedin.com/company/acme-corp?trk=x",
      "http://m.linkedin.com/company/acme-corp/about/",
      "linkedin.com/company/acme-corp",
    ]) {
      expect(normalizeCompanyLinkedinUrl(raw)).toEqual({
        url: "https://www.linkedin.com/company/acme-corp",
        slug: "acme-corp",
      });
    }
  });

  it("rejects non-company and non-linkedin URLs", () => {
    expect(
      normalizeCompanyLinkedinUrl("https://www.linkedin.com/in/someone"),
    ).toBeNull();
    expect(normalizeCompanyLinkedinUrl("https://acme.com")).toBeNull();
    expect(normalizeCompanyLinkedinUrl("not a url at all !!!")).toBeNull();
  });
});

describe("companyDedupKey", () => {
  it("prefers the slug, falls back to normalized name", () => {
    expect(
      companyDedupKey({ linkedinSlug: "acme-corp", name: "whatever" }),
    ).toBe("acme-corp");
    expect(
      companyDedupKey({ linkedinSlug: null, name: "  Acme   Corp " }),
    ).toBe("acme corp");
  });
});

describe("companyInputToParsed", () => {
  it("builds a ParsedCompany from a name-only input", () => {
    const p = companyInputToParsed({ name: "Acme" });
    expect(p).toMatchObject({
      name: "Acme",
      linkedinUrl: null,
      linkedinSlug: null,
      dedupKey: "acme",
    });
  });

  it("builds a ParsedCompany from a url-only input (slug becomes display name)", () => {
    const p = companyInputToParsed({
      linkedinUrl: "https://www.linkedin.com/company/Globex/",
    });
    expect(p).toMatchObject({
      name: "globex",
      linkedinUrl: "https://www.linkedin.com/company/globex",
      linkedinSlug: "globex",
      dedupKey: "globex",
    });
  });

  it("returns null when there is neither a name nor a valid company url", () => {
    expect(companyInputToParsed({})).toBeNull();
    expect(
      companyInputToParsed({ linkedinUrl: "https://acme.com" }),
    ).toBeNull();
  });
});

describe("parseCompanyRows", () => {
  it("maps Hebrew + English headers (Google Sheet export)", () => {
    const header = ["חברה", "שם באנגלית", "לינקדאין", "אתר", "וורטיקל"];
    const rows = [
      [
        "אקמי",
        "Acme",
        "https://www.linkedin.com/company/acme/",
        "acme.com",
        "Fintech",
      ],
      ["גלובקס", "", "", "globex.com", ""],
    ];
    const { companies, skippedInvalid } = parseCompanyRows(header, rows);
    expect(skippedInvalid).toBe(0);
    expect(companies[0]).toEqual({
      name: "Acme",
      nameHebrew: "אקמי",
      linkedinUrl: "https://www.linkedin.com/company/acme",
      linkedinSlug: "acme",
      website: "acme.com",
      vertical: "Fintech",
      dedupKey: "acme",
    });
    // Hebrew-only row: display name falls back to Hebrew
    expect(companies[1]).toMatchObject({
      name: "גלובקס",
      nameHebrew: "גלובקס",
      linkedinUrl: null,
    });
  });

  it("maps English-only headers", () => {
    const header = ["Company Name", "LinkedIn URL", "Website"];
    const rows = [
      ["Initech", "https://www.linkedin.com/company/initech", "initech.io"],
    ];
    const { companies } = parseCompanyRows(header, rows);
    expect(companies[0]).toMatchObject({
      name: "Initech",
      linkedinSlug: "initech",
      website: "initech.io",
    });
  });

  it("rescues a LinkedIn company URL that landed in the website/url column", () => {
    const header = ["name", "url"];
    const rows = [["Acme", "https://www.linkedin.com/company/acme"]];
    const { companies } = parseCompanyRows(header, rows);
    expect(companies[0]).toMatchObject({ linkedinSlug: "acme", website: null });
  });

  it("counts invalid rows without failing the batch", () => {
    const header = ["name", "linkedin"];
    const rows = [
      ["", ""],
      ["Acme", ""],
      ["", "https://acme.com/not-linkedin"],
    ];
    const { companies, skippedInvalid } = parseCompanyRows(header, rows);
    expect(companies).toHaveLength(1);
    expect(skippedInvalid).toBe(2);
  });
});
