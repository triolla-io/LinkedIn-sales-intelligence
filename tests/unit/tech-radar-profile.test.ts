import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_QUERIES_PER_COMPANY } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { pickInnerLinks, parseProfileResponse, researchProfile } = await import("@/lib/tech-radar/profile");

function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
const goodProfile = JSON.stringify({
  businessLines: [{ name: "Retail banking", description: "current accounts and cards" }],
  products: ["Bit"],
  customerSegments: ["consumers"],
  techStack: ["Temenos"],
  digitalInitiatives: ["mobile app rebuild"],
  focusAreas: [{ area: "payment fraud scoring", why: "high card volume" }],
  searchQueries: ["real-time payment fraud scoring launch"],
});

beforeEach(() => chat.mockReset());

describe("pickInnerLinks", () => {
  const base = "https://bank.co.il/";

  it("prefers product and solution pages over boilerplate", () => {
    const html = `
      <a href="/about">About us</a>
      <a href="/products">Products</a>
      <a href="/careers">Careers</a>
    `;
    expect(pickInnerLinks(html, base)[0]).toBe("https://bank.co.il/products");
  });

  it("matches Hebrew link text", () => {
    const html = '<a href="/prod">מוצרים</a><a href="/sol">פתרונות עסקיים</a>';
    expect(pickInnerLinks(html, base)).toHaveLength(2);
  });

  it("absolute-izes relative hrefs", () => {
    expect(pickInnerLinks('<a href="products/cards">Products</a>', base)).toEqual([
      "https://bank.co.il/products/cards",
    ]);
  });

  it("excludes anchors, mailto, tel and javascript", () => {
    const html = `
      <a href="#top">Products</a>
      <a href="mailto:x@y.com">Products</a>
      <a href="tel:+972">Products</a>
      <a href="javascript:void(0)">Products</a>
    `;
    expect(pickInnerLinks(html, base)).toEqual([]);
  });

  it("excludes login, careers, privacy and social links", () => {
    const html = `
      <a href="/login">Products login</a>
      <a href="/privacy">Privacy solutions</a>
      <a href="https://facebook.com/x">Products</a>
    `;
    expect(pickInnerLinks(html, base)).toEqual([]);
  });

  it("stays on the same origin", () => {
    expect(pickInnerLinks('<a href="https://other.com/products">Products</a>', base)).toEqual([]);
  });

  it("dedupes and respects the limit", () => {
    const html = Array.from({ length: 9 }, (_, i) => `<a href="/p${i}">Products</a>`).join("") +
      '<a href="/p0">Products</a>';
    expect(pickInnerLinks(html, base, 3)).toHaveLength(3);
  });

  it("skips the homepage itself and returns nothing for a bad base url", () => {
    expect(pickInnerLinks('<a href="/">Products</a>', base)).toEqual([]);
    expect(pickInnerLinks('<a href="/products">Products</a>', "not a url")).toEqual([]);
  });
});

describe("parseProfileResponse", () => {
  it("parses a fenced response", () => {
    const out = parseProfileResponse("```json\n" + goodProfile + "\n```");
    expect(out?.focusAreas[0].area).toBe("payment fraud scoring");
    expect(out?.techStack).toEqual(["Temenos"]);
  });

  it("coerces missing arrays to empty rather than crashing", () => {
    const out = parseProfileResponse('{"businessLines":[{"name":"x","description":"y"}]}');
    expect(out?.products).toEqual([]);
    expect(out?.focusAreas).toEqual([]);
    expect(out?.searchQueries).toEqual([]);
  });

  it("drops non-string junk and unnamed entries", () => {
    const out = parseProfileResponse(
      '{"products":["Bit",5,null,"  "],"businessLines":[{"description":"no name"},{"name":"Real","description":"d"}]}'
    );
    expect(out?.products).toEqual(["Bit"]);
    expect(out?.businessLines.map((b) => b.name)).toEqual(["Real"]);
  });

  it("caps the query count", () => {
    const many = Array.from({ length: MAX_QUERIES_PER_COMPANY + 5 }, (_, i) => `q${i}`);
    expect(parseProfileResponse(JSON.stringify({ searchQueries: many }))?.searchQueries).toHaveLength(
      MAX_QUERIES_PER_COMPANY
    );
  });

  it("recovers from truncated JSON", () => {
    const out = parseProfileResponse('{"products":["Bit","Poalim"],"focusAreas":[{"area":"a","why":"b"},{"area":"c');
    expect(out?.products).toEqual(["Bit", "Poalim"]);
  });

  it("returns null on prose", () => {
    expect(parseProfileResponse("I cannot")).toBeNull();
  });
});

describe("researchProfile", () => {
  const pages = [{ url: "https://bank.co.il/products", title: "Products", text: "cards and payments" }];
  const news = [{ title: "Bank launches app", url: "https://news.com/1", snippet: "s" }];

  it("returns a usable profile", async () => {
    chat.mockResolvedValue(ok(goodProfile));
    const out = await researchProfile({ companyName: "בנק הפועלים", website: "https://bank.co.il", pages, news });
    expect(out.searchQueries).toEqual(["real-time payment fraud scoring launch"]);
  });

  // A weak profile must be visible as weak, so sources record real reads only.
  it("overwrites sources with what was actually read", async () => {
    chat.mockResolvedValue(ok(JSON.stringify({ ...JSON.parse(goodProfile), sources: [{ url: "https://fake.com", title: "invented" }] })));
    const out = await researchProfile({ companyName: "x", website: null, pages, news });
    expect(out.sources.map((s) => s.url)).toEqual(["https://bank.co.il/products", "https://news.com/1"]);
  });

  it("is tagged for cost attribution and sends the page text", async () => {
    chat.mockResolvedValue(ok(goodProfile));
    await researchProfile({ companyName: "x", website: null, pages, news });
    expect(chat.mock.calls[0][0]).toBe("tech-radar-profile");
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("cards and payments");
  });

  it("throws when nothing could be read at all", async () => {
    await expect(researchProfile({ companyName: "x", website: null, pages: [], news: [] })).rejects.toThrow(
      /no sources/
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it("throws on a failed HTTP call", async () => {
    chat.mockResolvedValue({ ok: false, status: 500, data: {} });
    await expect(researchProfile({ companyName: "x", website: null, pages, news })).rejects.toThrow(/HTTP 500/);
  });

  it("throws on unparseable output", async () => {
    chat.mockResolvedValue(ok("nope"));
    await expect(researchProfile({ companyName: "x", website: null, pages, news })).rejects.toThrow(/unparseable/);
  });

  // The gate that stops an empty profile ever being scanned.
  it("refuses to activate a profile with no focus areas or queries", async () => {
    chat.mockResolvedValue(ok(JSON.stringify({ businessLines: [{ name: "x", description: "y" }] })));
    await expect(researchProfile({ companyName: "x", website: null, pages, news })).rejects.toThrow(
      /refusing to activate/
    );
  });
});
