import { describe, it, expect } from "vitest";
import { normalizeLinkedinUrl, parseCsvLine, parseConnectionRows } from "@/lib/csv/parse";

describe("normalizeLinkedinUrl", () => {
  it("normalizes a valid /in/ profile url", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/in/Jane-Doe/")).toBe(
      "https://www.linkedin.com/in/jane-doe",
    );
  });
  it("returns empty string for a non-profile url", () => {
    expect(normalizeLinkedinUrl("https://www.linkedin.com/company/acme")).toBe("");
  });
});

describe("parseCsvLine", () => {
  it("respects quoted fields containing commas", () => {
    expect(parseCsvLine('"Doe, Jane",jane@x.com')).toEqual(["Doe, Jane", "jane@x.com"]);
  });
});

describe("parseConnectionRows", () => {
  const header = ["First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"];
  it("maps LinkedIn export columns into ParsedContact objects", () => {
    const rows = [["Jane", "Doe", "https://www.linkedin.com/in/jane-doe", "jane@x.com", "Acme", "CEO", "01 Jan 2024"]];
    const out = parseConnectionRows(header, rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fullName: "Jane Doe",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      linkedinUrn: "urn:li:csv_import:jane-doe",
      email: "jane@x.com",
      currentCompany: "Acme",
      currentTitle: "CEO",
    });
    expect(typeof out[0].connectedAt === "string" || out[0].connectedAt === null).toBe(true);
  });
  it("skips rows with no name", () => {
    expect(parseConnectionRows(header, [["", "", "", "", "", "", ""]])).toHaveLength(0);
  });
});
