import { describe, it, expect } from "vitest";
import {
  anonymizeEmail,
  anonymizePhone,
  pickLinkedinUrl,
  assertStagingDatabase,
  parsePool,
} from "./anonymize.lib";

describe("anonymizeEmail", () => {
  it("routes every contact to ariel+<id>@triolla.io", () => {
    expect(anonymizeEmail("ckabc123")).toBe("ariel+ckabc123@triolla.io");
  });
});

describe("anonymizePhone", () => {
  it("returns the configured E.164 test number", () => {
    expect(anonymizePhone("+972500000000")).toBe("+972500000000");
  });
  it("rejects a non-E.164 number", () => {
    expect(() => anonymizePhone("0500000000")).toThrow(/E\.164/);
  });
});

describe("pickLinkedinUrl", () => {
  it("cycles through the pool by index", () => {
    const pool = ["https://linkedin.com/in/a", "https://linkedin.com/in/b"];
    expect(pickLinkedinUrl(0, pool)).toBe(pool[0]);
    expect(pickLinkedinUrl(1, pool)).toBe(pool[1]);
    expect(pickLinkedinUrl(2, pool)).toBe(pool[0]);
  });
});

describe("parsePool", () => {
  it("splits, trims, and drops empties", () => {
    expect(parsePool(" a , b ,, c ")).toEqual(["a", "b", "c"]);
  });
  it("throws on empty input", () => {
    expect(() => parsePool("")).toThrow(/pool/i);
  });
});

describe("assertStagingDatabase (fail closed)", () => {
  const stagingUrl = "postgresql://u:p@host:5432/linkedin-sales-db-staging?schema=public";
  const prodUrl = "postgresql://u:p@host:5432/linkedin-sales-db?schema=public";
  it("passes for a staging DB with confirm flag", () => {
    expect(() => assertStagingDatabase(stagingUrl, "1")).not.toThrow();
  });
  it("throws when DB name lacks 'staging'", () => {
    expect(() => assertStagingDatabase(prodUrl, "1")).toThrow(/staging/i);
  });
  it("throws when confirm flag is missing", () => {
    expect(() => assertStagingDatabase(stagingUrl, undefined)).toThrow(/confirm/i);
  });
});
