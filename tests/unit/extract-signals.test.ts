import { describe, it, expect } from "vitest";
import { hostOf, computeVerified, makeDedupeKey, parseSignalsResponse } from "@/lib/company-signals/extract";

describe("hostOf", () => {
  it("extracts registrable host, strips www", () => {
    expect(hostOf("https://www.techcrunch.com/2026/x")).toBe("techcrunch.com");
    expect(hostOf("not a url")).toBe(null);
  });
});

describe("computeVerified", () => {
  it("verified when 2+ distinct domains", () => {
    const r = computeVerified(
      [{ url: "https://techcrunch.com/a" }, { url: "https://calcalist.co.il/b" }],
      null
    );
    expect(r.verified).toBe(true);
    expect(r.distinctDomains).toBe(2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it("not verified with a single domain and no official source", () => {
    const r = computeVerified(
      [{ url: "https://blogspot.com/a" }, { url: "https://blogspot.com/b" }],
      "https://acme.com"
    );
    expect(r.verified).toBe(false);
  });
  it("verified from a single official company-domain source", () => {
    const r = computeVerified([{ url: "https://acme.com/press/funding" }], "https://www.acme.com");
    expect(r.verified).toBe(true);
  });
});

describe("makeDedupeKey", () => {
  it("is stable for the same type+title and differs across events", () => {
    expect(makeDedupeKey("FUNDING", "Acme raises $12M Series A!"))
      .toBe(makeDedupeKey("FUNDING", "Acme raises $12M Series A"));
    expect(makeDedupeKey("FUNDING", "Series A"))
      .not.toBe(makeDedupeKey("PRODUCT_LAUNCH", "Series A"));
  });
});

describe("parseSignalsResponse", () => {
  it("parses valid JSON, drops events with no source url", () => {
    const text = JSON.stringify({ events: [
      { signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: "2026-07-01",
        sources: [{ name: "TechCrunch", url: "https://techcrunch.com/x", publishedAt: null }] },
      { signalType: "AWARD", title: "no sources", summary: "s", eventDate: null, sources: [] },
    ]});
    const out = parseSignalsResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0].signalType).toBe("FUNDING");
  });
  it("strips markdown fences and rejects unknown types", () => {
    const text = "```json\n" + JSON.stringify({ events: [
      { signalType: "LAYOFF", title: "bad", summary: "s", eventDate: null, sources: [{ name: "x", url: "https://x.com/1", publishedAt: null }] },
    ]}) + "\n```";
    expect(parseSignalsResponse(text)).toHaveLength(0);
  });
  it("returns [] on garbage", () => {
    expect(parseSignalsResponse("not json")).toEqual([]);
  });
});
