import { describe, expect, it } from "vitest";
import { classifySource, rejectsAsGift } from "@/lib/tech-radar/source-quality";

/**
 * Gil Tamir's link pointed at streamlinefeed.co.ke, a content farm. A link handed to a
 * bank or insurance executive is a gift; a farm reprint is not. `rejectsAsGift` rejects
 * `aggregator` and `search_wrapper` ONLY — an `unknown` host passes and gets reported,
 * so the allowlist grows from evidence instead of guesses.
 */
describe("classifySource", () => {
  it("classifies the real Gil Tamir link as an aggregator, by name", () => {
    const { cls, host } = classifySource(
      "https://streamlinefeed.co.ke/news/unconventional-data-exposes-consumers-to-algorithmic-pricing-discrimination"
    );
    expect(cls).toBe("aggregator");
    expect(host).toBe("streamlinefeed.co.ke");
  });

  it("classifies a recognized Israeli publisher by name", () => {
    expect(classifySource("https://www.calcalist.co.il/article/1").cls).toBe("publisher");
  });

  it("classifies a recognized global publisher by name, subdomain included", () => {
    expect(classifySource("https://edition.reuters.com/business/x").cls).toBe("publisher");
    expect(classifySource("https://www.ft.com/content/x").cls).toBe("publisher");
  });

  /**
   * Fix round 1: the farm-shape substring check ran against the WHOLE host, so a real
   * publisher's own "feeds." or "rss." subdomain — a completely normal RSS-feed
   * hostname pattern — classified as an aggregator with no repair path. The allowlist
   * now runs first, and the farm-shape check only ever looks at the registrable label.
   */
  it("classifies a publisher's own feeds./rss. subdomain as publisher, not aggregator", () => {
    expect(classifySource("https://feeds.reuters.com/reuters/businessNews").cls).toBe("publisher");
    expect(classifySource("https://rss.calcalist.co.il/section/1").cls).toBe("publisher");
  });

  it("classifies a named aggregator host", () => {
    expect(classifySource("https://news.google.com/rss/articles/x").cls).toBe("aggregator");
    expect(classifySource("https://www.msn.com/en-us/news/x").cls).toBe("aggregator");
    expect(classifySource("https://www.flipboard.com/x").cls).toBe("aggregator");
    expect(classifySource("https://example.blogspot.com/2024/01/post.html").cls).toBe("aggregator");
  });

  it("classifies a press-release wire as an aggregator via the farm shape", () => {
    expect(classifySource("https://www.prnewswire.com/news-releases/x").cls).toBe("aggregator");
    expect(classifySource("https://www.globenewswire.com/news-release/x").cls).toBe("aggregator");
    expect(classifySource("https://www.businesswire.com/news/home/x").cls).toBe("aggregator");
  });

  it("classifies a search-engine host as search_wrapper", () => {
    expect(classifySource("https://www.google.com/search?q=x").cls).toBe("search_wrapper");
    expect(classifySource("https://www.bing.com/search?q=x").cls).toBe("search_wrapper");
  });

  it("classifies an unrecognized host as unknown, not a rejection", () => {
    const { cls, host } = classifySource("https://a-fintech-startup-blog.example.com/post/1");
    expect(cls).toBe("unknown");
    expect(host).toBe("a-fintech-startup-blog.example.com");
  });
});

describe("rejectsAsGift", () => {
  it("rejects an aggregator", () => {
    expect(rejectsAsGift("https://streamlinefeed.co.ke/news/x")).toBe(true);
  });

  it("rejects a search-engine wrapper", () => {
    expect(rejectsAsGift("https://news.google.com/rss/articles/x")).toBe(true);
  });

  it("passes a recognized publisher", () => {
    expect(rejectsAsGift("https://www.globes.co.il/news/article.aspx?did=1")).toBe(false);
  });

  it("passes an unknown host — the ruling is: unknown hosts are never rejected", () => {
    expect(rejectsAsGift("https://a-fintech-startup-blog.example.com/post/1")).toBe(false);
  });
});
