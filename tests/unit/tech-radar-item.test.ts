import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TriageVerdict } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { makeItemDedupeKey, parseItemResponse, synthesizeItem } = await import("@/lib/tech-radar/item");

const triage: TriageVerdict = {
  url: "https://news.com/a",
  isLaunch: true,
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

  it("is case and punctuation insensitive", () => {
    expect(makeItemDedupeKey("ACME!!", "  fraud-shield  ")).toBe(makeItemDedupeKey("acme", "fraud shield"));
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
