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

import { chunkArray, extractAllArticles } from "@/lib/fintech-radar/extract";
import type { NewsResult } from "@/lib/news/types";
import type { ExtractedArticle } from "@/lib/fintech-radar/extract";

describe("chunkArray", () => {
  it("splits into fixed-size chunks, last may be smaller", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns a single chunk when size <= 0", () => {
    expect(chunkArray([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

describe("extractAllArticles", () => {
  const mkNews = (n: number): NewsResult[] =>
    Array.from({ length: n }, (_, i) => ({ title: `t${i}`, url: `https://x/${i}`, snippet: "", source: "tavily", publishedAt: null }));
  const mkArt = (url: string): ExtractedArticle => ({ title: "T", url, summary: "s", topics: [], mentionedCompanies: [], relevantRoles: [], publishedAt: null });

  it("chunks the input and calls the extractor once per chunk", async () => {
    const calls: number[] = [];
    const extractor = async (chunk: NewsResult[]) => { calls.push(chunk.length); return chunk.map((c) => mkArt(c.url)); };
    const out = await extractAllArticles(mkNews(45), { chunkSize: 20, extractor });
    expect(calls).toEqual([20, 20, 5]); // ceil(45/20) = 3 chunks
    expect(out).toHaveLength(45);
  });

  it("dedupes merged results by url across chunks", async () => {
    // extractor returns the same url from two different chunks
    const extractor = async (chunk: NewsResult[]) => chunk.map(() => mkArt("https://dupe/1"));
    const out = await extractAllArticles(mkNews(4), { chunkSize: 2, extractor });
    expect(out).toHaveLength(1);
  });
});
