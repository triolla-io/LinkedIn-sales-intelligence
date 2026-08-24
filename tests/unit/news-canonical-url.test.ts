import { describe, it, expect } from "vitest";
import { canonicalizeSourceUrl, isSearchEngineHost } from "@/lib/news/canonical-url";

/**
 * The 2026-08-24 run sent a real person a message whose link was
 * google.com/goto?url=CAESvQEB… — a search-engine redirect, not the article. The
 * providers hand these back as result URLs, and everything downstream (dedupe keys,
 * stored sources, the message itself) inherited it. Canonicalization happens at the
 * read stage so nothing downstream ever sees a wrapped URL it could have unwrapped.
 */
describe("canonicalizeSourceUrl", () => {
  it("unwraps a google redirect whose param carries the real URL", () => {
    expect(canonicalizeSourceUrl("https://www.google.com/url?q=https://real.com/story&ved=abc")).toBe(
      "https://real.com/story"
    );
  });

  it("unwraps a percent-encoded target", () => {
    expect(canonicalizeSourceUrl("https://google.com/goto?url=https%3A%2F%2Freal.com%2Fa%3Fid%3D7")).toBe(
      "https://real.com/a?id=7"
    );
  });

  it("unwraps nested redirects, bounded", () => {
    const inner = encodeURIComponent("https://real.com/x");
    const outer = `https://www.google.com/url?q=${encodeURIComponent(`https://bing.com/r?u=${inner}`)}`;
    expect(canonicalizeSourceUrl(outer)).toBe("https://real.com/x");
  });

  // The Uri/MLB case exactly: the param is an opaque token, not a URL. There is nothing
  // to unwrap statically — the caller must detect the search-engine host and skip it.
  it("leaves an opaque google token alone rather than inventing a target", () => {
    const opaque = "https://google.com/goto?url=CAESvQEB0xy";
    expect(canonicalizeSourceUrl(opaque)).toBe(opaque);
    expect(isSearchEngineHost(canonicalizeSourceUrl(opaque))).toBe(true);
  });

  it("strips tracking params from any URL", () => {
    expect(canonicalizeSourceUrl("https://real.com/a?utm_source=x&id=7&gclid=g&fbclid=f&mc_cid=m")).toBe(
      "https://real.com/a?id=7"
    );
  });

  it("does not touch a clean URL — not even to re-serialize it", () => {
    expect(canonicalizeSourceUrl("https://c.com")).toBe("https://c.com");
    expect(canonicalizeSourceUrl("https://real.com/a?x=1&y=2")).toBe("https://real.com/a?x=1&y=2");
  });

  it("does not unwrap URL-shaped params on a normal publisher host", () => {
    const legit = "https://real.com/share?target=https://other.com/b";
    expect(canonicalizeSourceUrl(legit)).toBe(legit);
  });

  it("returns a non-URL string as-is", () => {
    expect(canonicalizeSourceUrl("not a url")).toBe("not a url");
  });
});

describe("isSearchEngineHost", () => {
  it("recognises search engines by host or by full URL", () => {
    expect(isSearchEngineHost("google.com")).toBe(true);
    expect(isSearchEngineHost("news.google.com")).toBe(true);
    expect(isSearchEngineHost("www.google.co.il")).toBe(true);
    expect(isSearchEngineHost("www.bing.com")).toBe(true);
    expect(isSearchEngineHost("https://google.com/goto?url=CAES")).toBe(true);
  });

  it("does not flag publishers — including ones with 'google' inside the name", () => {
    expect(isSearchEngineHost("polymarket.com")).toBe(false);
    expect(isSearchEngineHost("https://real.com/a")).toBe(false);
    expect(isSearchEngineHost("googlewatch.example.com")).toBe(false);
  });
});
