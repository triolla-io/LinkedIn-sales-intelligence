import { describe, it, expect } from "vitest";
import { parseArticlesResponse } from "@/lib/fintech-radar/extract";

describe("parseArticlesResponse", () => {
  it("parses a clean JSON object", () => {
    const out = parseArticlesResponse(
      JSON.stringify({ articles: [{ title: "T", url: "https://x.com/a", summary: "S", topics: ["payments"], mentionedCompanies: ["Acme"], relevantRoles: ["CTO"], publishedAt: "2026-07-20" }] })
    );
    expect(out).toHaveLength(1);
    expect(out[0].topics).toEqual(["payments"]);
    expect(out[0].mentionedCompanies).toEqual(["Acme"]);
  });
  it("tolerates markdown fences", () => {
    const out = parseArticlesResponse('```json\n{"articles":[{"title":"T","url":"https://x.com/a","summary":"S","topics":[],"mentionedCompanies":[],"relevantRoles":[],"publishedAt":null}]}\n```');
    expect(out).toHaveLength(1);
  });
  it("drops entries missing a url", () => {
    const out = parseArticlesResponse(JSON.stringify({ articles: [{ title: "T", url: "", summary: "S", topics: [], mentionedCompanies: [], relevantRoles: [], publishedAt: null }] }));
    expect(out).toHaveLength(0);
  });
  it("returns [] on garbage", () => {
    expect(parseArticlesResponse("not json")).toEqual([]);
  });
});
