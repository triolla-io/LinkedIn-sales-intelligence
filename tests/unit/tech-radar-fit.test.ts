import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TechRadarProfile } from "@/lib/tech-radar/types";

const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const { prefilterItems, alreadyInStack, parseFitResponse, judgeFit, profileTerms } = await import(
  "@/lib/tech-radar/fit"
);
type FitItem = Parameters<typeof alreadyInStack>[1];

function profile(over: Partial<TechRadarProfile> = {}): TechRadarProfile {
  return {
    businessLines: [{ name: "Retail payments", description: "cards and P2P" }],
    products: ["Bit"],
    customerSegments: ["consumers"],
    techStack: [],
    digitalInitiatives: [],
    focusAreas: [{ area: "fraud detection", why: "card volume" }],
    searchQueries: ["fraud detection launch"],
    sources: [],
    ...over,
  };
}

function item(over: Partial<FitItem> = {}): FitItem {
  return {
    itemId: "i1",
    vendor: "Acme",
    technology: "Fraud Shield",
    title: "Acme launches Fraud Shield",
    summary: "A fraud detection service.",
    categories: ["fraud detection"],
    ...over,
  };
}

beforeEach(() => chat.mockReset());

describe("profileTerms", () => {
  it("draws terms from focus areas, business lines and products", () => {
    const terms = profileTerms(profile());
    expect(terms.has("fraud")).toBe(true);
    expect(terms.has("detection")).toBe(true);
    expect(terms.has("retail")).toBe(true);
  });
  it("drops stopwords and very short tokens", () => {
    const terms = profileTerms(profile({ focusAreas: [{ area: "the new AI platform", why: "x" }] }));
    expect(terms.has("the")).toBe(false);
    expect(terms.has("new")).toBe(false);
    expect(terms.has("platform")).toBe(false);
  });
});

describe("alreadyInStack", () => {
  it("drops an item whose vendor the company already runs", () => {
    expect(alreadyInStack(profile({ techStack: ["Acme Corp"] }), item())).toBe(true);
  });
  it("matches when the stack entry is narrower than the item name", () => {
    expect(alreadyInStack(profile({ techStack: ["fraud shield enterprise"] }), item())).toBe(true);
  });
  it("does not match an unrelated stack", () => {
    expect(alreadyInStack(profile({ techStack: ["Salesforce", "Snowflake"] }), item())).toBe(false);
  });
  it("ignores stack entries too short to be evidence", () => {
    expect(alreadyInStack(profile({ techStack: ["AI", "go"] }), item())).toBe(false);
  });
  it("returns false for an empty stack", () => {
    expect(alreadyInStack(profile(), item())).toBe(false);
  });
});

describe("prefilterItems", () => {
  it("ranks category-overlapping items above unrelated ones", () => {
    const out = prefilterItems(profile(), [
      item({ itemId: "unrelated", categories: ["insurance claims"], technology: "Claimly" }),
      item({ itemId: "match", categories: ["fraud detection"], technology: "Fraud Shield" }),
    ]);
    expect(out[0].itemId).toBe("match");
  });

  it("drops items already in the tech stack", () => {
    const out = prefilterItems(profile({ techStack: ["Fraud Shield"] }), [item()]);
    expect(out).toHaveLength(0);
  });

  it("caps the shortlist", () => {
    const many = Array.from({ length: 40 }, (_, i) => item({ itemId: `i${i}` }));
    expect(prefilterItems(profile(), many).length).toBeLessThanOrEqual(15);
  });

  it("is deterministic regardless of input order", () => {
    const items = [item({ itemId: "b" }), item({ itemId: "a" }), item({ itemId: "c" })];
    const first = prefilterItems(profile(), items).map((i) => i.itemId);
    const second = prefilterItems(profile(), [...items].reverse()).map((i) => i.itemId);
    expect(first).toEqual(second);
  });

  // A profile with no usable terms must not silently drop every item.
  it("passes items through when the profile yields no terms", () => {
    const bare = profile({ focusAreas: [], businessLines: [], products: [] });
    expect(prefilterItems(bare, [item(), item({ itemId: "i2" })])).toHaveLength(2);
  });
});

describe("parseFitResponse", () => {
  it("parses a fenced response", () => {
    const out = parseFitResponse(
      '```json\n{"fits":true,"fitRationale":"מתחבר לביט","score":0.8,"businessLine":"Retail payments"}\n```'
    );
    expect(out).toEqual({
      fits: true,
      fitRationale: "מתחבר לביט",
      score: 0.8,
      businessLine: "Retail payments",
    });
  });

  // The line attribution is what stops one business line taking every slot.
  it("nulls a missing or blank business line rather than failing", () => {
    expect(parseFitResponse('{"fits":true,"fitRationale":"x","score":0.5}')?.businessLine).toBeNull();
    expect(
      parseFitResponse('{"fits":true,"fitRationale":"x","score":0.5,"businessLine":"  "}')?.businessLine
    ).toBeNull();
  });
  it("clamps an out-of-range score", () => {
    expect(parseFitResponse('{"fits":true,"fitRationale":"x","score":9}')?.score).toBe(1);
  });
  it("treats a missing fits field as false", () => {
    expect(parseFitResponse('{"fitRationale":"x"}')?.fits).toBe(false);
  });
  it("rejects a fits=true verdict with no rationale — the rationale IS the output", () => {
    expect(parseFitResponse('{"fits":true,"fitRationale":"  ","score":0.9}')).toBeNull();
  });
  it("returns null on prose", () => {
    expect(parseFitResponse("I cannot help with that")).toBeNull();
  });
});

describe("judgeFit", () => {
  function ok(content: string) {
    return { ok: true, status: 200, data: { choices: [{ message: { content } }] } };
  }

  it("returns the parsed verdict", async () => {
    chat.mockResolvedValue(
      ok('{"fits":true,"fitRationale":"מתחבר לביט","score":0.7,"businessLine":"Retail payments"}')
    );
    await expect(judgeFit(profile(), "בנק הפועלים", item())).resolves.toEqual({
      fits: true,
      fitRationale: "מתחבר לביט",
      score: 0.7,
      businessLine: "Retail payments",
    });
  });

  it("sends the full profile and is tagged for cost attribution", async () => {
    chat.mockResolvedValue(ok('{"fits":false,"fitRationale":"","score":0.1}'));
    await judgeFit(profile(), "בנק הפועלים", item());
    const [feature, body] = chat.mock.calls[0];
    expect(feature).toBe("tech-radar-fit");
    const user = (body as { messages: { content: string }[] }).messages[1].content;
    expect(user).toContain("Retail payments");
    expect(user).toContain("Bit");
    expect(user).toContain("fraud detection");
  });

  it("throws on a failed HTTP call so the Inngest step retries", async () => {
    chat.mockResolvedValue({ ok: false, status: 502, data: {} });
    await expect(judgeFit(profile(), "x", item())).rejects.toThrow(/HTTP 502/);
  });

  it("throws on unparseable output", async () => {
    chat.mockResolvedValue(ok("sorry, no"));
    await expect(judgeFit(profile(), "x", item())).rejects.toThrow(/unparseable/);
  });
});
