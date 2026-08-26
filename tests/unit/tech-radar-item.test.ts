import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TriageVerdict } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { makeItemDedupeKey, isSameTechnology, isSameLaunch, parseItemResponse, synthesizeItem } =
  await import("@/lib/tech-radar/item");

const triage: TriageVerdict = {
  url: "https://news.com/a",
  shareworthy: 0.8,
  stature: 0.8,
  israelRelevant: false,
  kind: "research",
  publisher: "news.com",
  staleness: false,
  categories: ["fraud detection"],
  vendor: "Acme",
  technology: "Fraud Shield",
};

function ok(content: string) {
  return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
}
const goodJson = JSON.stringify({
  vendor: "Acme",
  technology: "Fraud Shield",
  title: "Acme launches Fraud Shield",
  summary: "A fraud detection service that scores transactions inline.",
  categories: ["Fraud Detection", "payments"],
});

beforeEach(() => chat.mockReset());

// The anti-triplet guarantee: one launch covered by three outlets, phrased three
// ways, must collapse to a single TechItem.
describe("makeItemDedupeKey", () => {
  it("collapses the same launch phrased three different ways", () => {
    const keys = new Set([
      makeItemDedupeKey("Stripe", "Radar Assistant"),
      makeItemDedupeKey("Stripe Inc.", "the new Radar Assistant"),
      makeItemDedupeKey("stripe", "Radar Assistant platform"),
    ]);
    expect(keys.size).toBe(1);
  });

  it("collapses launch verbs and articles out of the technology name", () => {
    expect(makeItemDedupeKey("Plaid", "Plaid announces Layer")).toBe(makeItemDedupeKey("Plaid", "Layer"));
  });

  it("strips corporate suffixes from the vendor", () => {
    expect(makeItemDedupeKey("Adyen N.V.", "Uplift")).toBe(makeItemDedupeKey("Adyen", "Uplift"));
  });

  it("does NOT collide two different technologies from one vendor", () => {
    expect(makeItemDedupeKey("Stripe", "Radar Assistant")).not.toBe(makeItemDedupeKey("Stripe", "Billing Credits"));
  });

  it("does NOT collide the same technology name from two vendors", () => {
    expect(makeItemDedupeKey("Acme", "Shield")).not.toBe(makeItemDedupeKey("Globex", "Shield"));
  });

  it("produces a stable key when the vendor is unknown", () => {
    expect(makeItemDedupeKey(null, "Open Payments Standard")).toBe(makeItemDedupeKey(null, "open payments standard"));
    expect(makeItemDedupeKey(null, "Shield")).not.toBe(makeItemDedupeKey("Acme", "Shield"));
  });

  it("keeps a technology genuinely named with a generic word", () => {
    expect(makeItemDedupeKey("Acme", "Platform")).toContain("platform");
  });

  /**
   * From the live Delek Group run: Heron Data's launch was written up twice, as
   * "Automated Background Checks" and "Automated Background Check System", and both
   * were stored — the feed showed the same launch twice.
   */
  it("collapses singular and plural forms of the same technology", () => {
    expect(makeItemDedupeKey("Heron Data", "Automated Background Checks")).toBe(
      makeItemDedupeKey("Heron Data", "Automated Background Check System")
    );
  });

  it("does not mangle words that merely end in s", () => {
    // "analysis" and "access" must not lose their trailing s.
    expect(makeItemDedupeKey(null, "Risk Analysis")).not.toBe(makeItemDedupeKey(null, "Risk Analysi"));
    expect(makeItemDedupeKey(null, "Access Control")).toContain("access");
  });

  /**
   * Two outlets covering the same announcement named the same two bodies in opposite
   * order, and the live Delek run stored the launch twice — the CEO then received two
   * near-identical messages about it.
   */
  it("ignores the order of a multi-party vendor", () => {
    expect(makeItemDedupeKey("GHG Protocol and ISO", "Unified Carbon Accounting Standard")).toBe(
      makeItemDedupeKey("ISO and GHG Protocol", "Unified Carbon Accounting Standard")
    );
  });

  it("is case and punctuation insensitive", () => {
    expect(makeItemDedupeKey("ACME!!", "  fraud-shield  ")).toBe(makeItemDedupeKey("acme", "fraud shield"));
  });
});

/**
 * Same event, same parties, one word apart: "unified corporate greenhouse gas accounting
 * standard" vs "unified corporate carbon accounting standard". An exact key cannot catch
 * that, so near-identical names are compared by token overlap.
 */
describe("isSameTechnology", () => {
  it("treats two phrasings of the same standard as one", () => {
    expect(
      isSameTechnology(
        "Unified Corporate Greenhouse Gas Accounting Standard",
        "Unified Corporate Carbon Accounting Standard"
      )
    ).toBe(true);
  });

  it("keeps genuinely different technologies apart", () => {
    expect(isSameTechnology("Radar Assistant", "Billing Credits")).toBe(false);
    expect(isSameTechnology("Fraud Shield", "Fraud Detection Platform")).toBe(false);
  });

  it("matches identical names regardless of case and punctuation", () => {
    expect(isSameTechnology("Fraud-Shield", "fraud shield")).toBe(true);
  });

  it("does not collapse two short unrelated names", () => {
    expect(isSameTechnology("Qore", "Vulcan")).toBe(false);
  });

  it("handles empty input without throwing", () => {
    expect(isSameTechnology("", "")).toBe(false);
    expect(isSameTechnology("Shield", "")).toBe(false);
  });
});

describe("parseItemResponse", () => {
  it("parses a fenced response and normalizes categories", () => {
    const out = parseItemResponse("```json\n" + goodJson + "\n```");
    expect(out?.technology).toBe("Fraud Shield");
    expect(out?.categories).toEqual(["fraud detection", "payments"]);
  });

  it("falls back to the technology name when no title is given", () => {
    expect(parseItemResponse('{"technology":"Shield","summary":"does things"}')?.title).toBe("Shield");
  });

  it("nulls an empty vendor", () => {
    expect(parseItemResponse('{"technology":"S","summary":"x","vendor":"  "}')?.vendor).toBeNull();
  });

  it("returns null without a technology or without a summary", () => {
    expect(parseItemResponse('{"summary":"x"}')).toBeNull();
    expect(parseItemResponse('{"technology":"S"}')).toBeNull();
  });

  it("returns null on prose", () => {
    expect(parseItemResponse("Sorry, I can't")).toBeNull();
  });
});

/**
 * Two outlets covered TGS's seismic AI launch as "TGS Seismic Foundation Model" and
 * "AI Model for Subsurface Interpretation". The names share only the word "model", so
 * name overlap cannot catch it — but both write-ups produced the SAME four categories
 * ("subsurface interpretation", "seismic analysis", "ai", "machine learning"), which is
 * not a coincidence at that specificity.
 */
describe("isSameLaunch", () => {
  const tgsA = {
    technology: "TGS Seismic Foundation Model",
    categories: ["seismic analysis", "ai", "subsurface interpretation", "machine learning"],
  };
  const tgsB = {
    technology: "AI Model for Subsurface Interpretation",
    categories: ["subsurface interpretation", "seismic analysis", "ai", "machine learning"],
  };

  it("merges two differently-named write-ups that classify identically", () => {
    expect(isSameLaunch(tgsA, tgsB)).toBe(true);
  });

  it("still merges on name overlap when categories differ", () => {
    expect(
      isSameLaunch(
        { technology: "Unified Corporate Carbon Accounting Standard", categories: ["carbon accounting"] },
        { technology: "Unified Corporate Greenhouse Gas Accounting Standard", categories: ["ghg reporting"] }
      )
    ).toBe(true);
  });

  // Two real launches from one vendor often share a couple of broad tags; that is not
  // evidence they are the same thing.
  it("does not merge on a couple of broad shared tags", () => {
    expect(
      isSameLaunch(
        { technology: "Radar Assistant", categories: ["payments", "api"] },
        { technology: "Billing Credits", categories: ["payments", "api"] }
      )
    ).toBe(false);
  });

  it("does not merge when the categories only partly overlap", () => {
    expect(
      isSameLaunch(
        { technology: "Alpha Engine", categories: ["fraud detection", "payments", "machine learning"] },
        { technology: "Beta Console", categories: ["fraud detection", "reporting", "compliance"] }
      )
    ).toBe(false);
  });

  it("ignores category order and case", () => {
    expect(
      isSameLaunch(
        { technology: "One Thing", categories: ["Alpha Area", "beta area", "gamma area"] },
        { technology: "Other Thing", categories: ["gamma area", "ALPHA AREA", "Beta Area"] }
      )
    ).toBe(true);
  });

  it("handles empty categories without throwing", () => {
    expect(isSameLaunch({ technology: "A", categories: [] }, { technology: "B", categories: [] })).toBe(false);
  });
});

describe("item synthesis prompt", () => {
  // The rep reads these in a Hebrew UI; an English write-up makes them translate in
  // their head before they can judge whether it is worth sending.
  it("asks for the summary in Hebrew", async () => {
    chat.mockResolvedValue(ok(goodJson));
    await synthesizeItem({ triage, articles: [], pages: [] });
    const system = (chat.mock.calls[0][1] as { messages: { content: string }[] }).messages[0].content;
    expect(system).toMatch(/Hebrew/);
    expect(system).toMatch(/summary/);
  });

  it("keeps product and vendor names untranslated", () => {
    chat.mockResolvedValue(ok(goodJson));
    // Asserted on the prompt: proper nouns must survive verbatim.
    return synthesizeItem({ triage, articles: [], pages: [] }).then(() => {
      const system = (chat.mock.calls[0][1] as { messages: { content: string }[] }).messages[0].content;
      expect(system).toMatch(/do not translate|verbatim/i);
    });
  });

  it("keeps the category tags in English for matching", async () => {
    chat.mockResolvedValue(ok(goodJson));
    await synthesizeItem({ triage, articles: [], pages: [] });
    const system = (chat.mock.calls[0][1] as { messages: { content: string }[] }).messages[0].content;
    expect(system).toMatch(/categories[\s\S]*English|English[\s\S]*categories/i);
  });
});

describe("synthesizeItem", () => {
  const articles = [
    { url: "https://news.com/a", title: "Coverage A", snippet: "s", publishedAt: "2026-08-01" },
    { url: "https://news.com/b", title: "Coverage B", snippet: "s", publishedAt: null },
  ];

  it("marks the item thin when no page could be read", async () => {
    chat.mockResolvedValue(ok(goodJson));
    const out = await synthesizeItem({ triage, articles, pages: [] });
    expect(out.thin).toBe(true);
  });

  it("is not thin when real page text was available", async () => {
    chat.mockResolvedValue(ok(goodJson));
    const out = await synthesizeItem({
      triage,
      articles,
      pages: [{ url: "https://acme.com/shield", title: "Shield", text: "full page body" }],
    });
    expect(out.thin).toBe(false);
  });

  it("builds sources from the real coverage, not from model output", async () => {
    chat.mockResolvedValue(ok(goodJson));
    const out = await synthesizeItem({ triage, articles, pages: [] });
    expect(out.sources.map((s) => s.url)).toEqual(["https://news.com/a", "https://news.com/b"]);
    expect(out.publishedAt).toBe("2026-08-01");
  });

  it("is tagged for cost attribution and includes page text in the prompt", async () => {
    chat.mockResolvedValue(ok(goodJson));
    await synthesizeItem({
      triage,
      articles,
      pages: [{ url: "https://acme.com/x", title: null, text: "DISTINCTIVE_BODY_TEXT" }],
    });
    expect(chat.mock.calls[0][0]).toBe("tech-radar-item");
    const body = chat.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain("DISTINCTIVE_BODY_TEXT");
  });

  it("throws on a failed HTTP call so the Inngest step retries", async () => {
    chat.mockResolvedValue({ ok: false, status: 503, data: {} });
    await expect(synthesizeItem({ triage, articles, pages: [] })).rejects.toThrow(/HTTP 503/);
  });

  it("throws on unparseable output", async () => {
    chat.mockResolvedValue(ok("no json here"));
    await expect(synthesizeItem({ triage, articles, pages: [] })).rejects.toThrow(/unparseable/);
  });
});
