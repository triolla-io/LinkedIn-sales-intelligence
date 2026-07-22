import { describe, it, expect } from "vitest";
import { FINTECH_TOPICS } from "@/lib/fintech-radar/topics";
import { normalizeUrl } from "@/lib/fintech-radar/fetch-topic-news";

describe("FINTECH_TOPICS", () => {
  it("has a reasonable number of distinct topic queries", () => {
    expect(FINTECH_TOPICS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(FINTECH_TOPICS).size).toBe(FINTECH_TOPICS.length);
  });
  it("covers core fintech themes", () => {
    const joined = FINTECH_TOPICS.join(" | ").toLowerCase();
    for (const term of ["fintech", "stablecoin", "payments", "embedded finance", "open banking", "lending"]) {
      expect(joined).toContain(term);
    }
  });
});

describe("normalizeUrl", () => {
  it("lowercases host, drops utm params and trailing slash", () => {
    expect(normalizeUrl("https://Example.com/Article/?utm_source=x&id=5")).toBe("https://example.com/Article?id=5");
  });
  it("treats http/https and www as the same", () => {
    expect(normalizeUrl("http://www.example.com/a/")).toBe("https://example.com/a");
  });
  it("returns the input unchanged when it is not a valid URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});
