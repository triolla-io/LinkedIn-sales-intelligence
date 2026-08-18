import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reserve = vi.fn(async () => true);
vi.mock("@/lib/news/budget", () => ({ reserveNewsCall: (...a: unknown[]) => reserve(...a) }));

const { htmlToText, readPage, readPages, MAX_PAGE_CHARS } = await import("@/lib/research/read-page");

function htmlResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => body,
    json: async () => ({}),
  };
}

function tavilyResponse(raw: string | null, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => "",
    json: async () => ({ results: raw === null ? [] : [{ url: "https://x.com", raw_content: raw }] }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  reserve.mockReset();
  reserve.mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
  process.env.TAVILY_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TAVILY_API_KEY;
});

describe("htmlToText", () => {
  it("strips script, style and comments", () => {
    const { text } = htmlToText(
      "<html><head><style>.a{color:red}</style></head><body><script>alert(1)</script><!-- note --><p>Real content</p></body></html>"
    );
    expect(text).toBe("Real content");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color");
  });

  it("extracts the title", () => {
    expect(htmlToText("<title>  Acme &amp; Co  </title><p>x</p>").title).toBe("Acme & Co");
  });

  it("returns a null title when there is none", () => {
    expect(htmlToText("<p>x</p>").title).toBeNull();
  });

  it("decodes named and numeric entities", () => {
    const { text } = htmlToText("<p>a &lt; b &#38; c &#x41; &nbsp;d</p>");
    expect(text).toContain("a < b & c A");
    expect(text).toContain("d");
  });

  it("does not glue words across block tags", () => {
    expect(htmlToText("<p>first</p><p>second</p>").text).toBe("first\nsecond");
  });

  it("collapses runs of whitespace", () => {
    expect(htmlToText("<p>a     b\t\tc</p>").text).toBe("a b c");
  });
});

describe("readPage", () => {
  it("returns Tavily Extract content when available", async () => {
    fetchMock.mockResolvedValueOnce(tavilyResponse("extracted body text"));
    const page = await readPage("https://example.com/a");
    expect(page?.text).toBe("extracted body text");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("tavily.com/extract");
  });

  it("falls back to plain fetch when Extract returns non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(tavilyResponse(null, 500));
    fetchMock.mockResolvedValueOnce(htmlResponse("<p>fallback body</p>"));
    const page = await readPage("https://example.com/a");
    expect(page?.text).toBe("fallback body");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back when Extract returns an empty result", async () => {
    fetchMock.mockResolvedValueOnce(tavilyResponse(null));
    fetchMock.mockResolvedValueOnce(htmlResponse("<p>fallback</p>"));
    expect((await readPage("https://example.com/a"))?.text).toBe("fallback");
  });

  it("skips Tavily entirely when the news budget is exhausted", async () => {
    reserve.mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce(htmlResponse("<p>direct</p>"));
    const page = await readPage("https://example.com/a");
    expect(page?.text).toBe("direct");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).not.toContain("tavily");
  });

  it("skips Tavily when no API key is configured", async () => {
    delete process.env.TAVILY_API_KEY;
    fetchMock.mockResolvedValueOnce(htmlResponse("<p>direct</p>"));
    await readPage("https://example.com/a");
    expect(reserve).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).not.toContain("tavily");
  });

  // Load-bearing: research must survive one unreadable page.
  it("returns null instead of throwing when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(readPage("https://example.com/a")).resolves.toBeNull();
  });

  it("returns null on a non-2xx page", async () => {
    fetchMock.mockResolvedValueOnce(tavilyResponse(null, 500));
    fetchMock.mockResolvedValueOnce(htmlResponse("", 404));
    expect(await readPage("https://example.com/a")).toBeNull();
  });

  it("rejects non-http schemes without any request", async () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "not a url"]) {
      expect(await readPage(url)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-markup content types", async () => {
    reserve.mockResolvedValue(false);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/pdf" },
      text: async () => "%PDF-1.4",
      json: async () => ({}),
    });
    expect(await readPage("https://example.com/a.pdf")).toBeNull();
  });

  it("truncates to MAX_PAGE_CHARS", async () => {
    fetchMock.mockResolvedValueOnce(tavilyResponse("x".repeat(MAX_PAGE_CHARS + 500)));
    expect((await readPage("https://example.com/a"))?.text.length).toBe(MAX_PAGE_CHARS);
  });
});

describe("readPages", () => {
  it("respects the limit", async () => {
    fetchMock.mockResolvedValue(tavilyResponse("body"));
    const out = await readPages(["https://a.com", "https://b.com", "https://c.com"], { limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("drops failures and keeps the successes", async () => {
    fetchMock
      .mockResolvedValueOnce(tavilyResponse("first"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(tavilyResponse("third"));
    const out = await readPages(["https://a.com", "https://b.com", "https://c.com"]);
    expect(out.map((p) => p.text)).toEqual(["first", "third"]);
  });

  it("returns empty for no urls and for a zero limit", async () => {
    expect(await readPages([])).toEqual([]);
    expect(await readPages(["https://a.com"], { limit: 0 })).toEqual([]);
  });
});
