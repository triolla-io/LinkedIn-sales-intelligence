import { describe, it, expect } from "vitest";
import { parseCompanyLines } from "@/lib/prospecting/company-lines";

describe("parseCompanyLines", () => {
  it("splits lines into name-only and linkedin-url companies", () => {
    const out = parseCompanyLines(
      "Acme Corp\nhttps://www.linkedin.com/company/globex/\n\n  Initech  \n",
    );
    expect(out).toEqual([
      { name: "Acme Corp" },
      { linkedinUrl: "https://www.linkedin.com/company/globex/" },
      { name: "Initech" },
    ]);
  });

  it("treats any linkedin.com line as a url even without protocol", () => {
    expect(parseCompanyLines("linkedin.com/company/acme")).toEqual([
      { linkedinUrl: "linkedin.com/company/acme" },
    ]);
  });

  it("returns empty array for blank input", () => {
    expect(parseCompanyLines("  \n\n ")).toEqual([]);
  });
});
