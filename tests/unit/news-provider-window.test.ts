import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/news/budget", () => ({ reserveNewsCall: async () => true }));

// Capture the URL each provider requests, without hitting the network.
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("GNEWS_API_KEY", "test");
  vi.stubEnv("SERPER_API_KEY", "test");
  // Serper's window parameter lands in the POST body, not the URL — capture both,
  // or the assertion below would only ever see the fixed request URL.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push(String(input) + (init?.body ? ` ${String(init.body)}` : ""));
    return new Response(JSON.stringify({ articles: [], news: [] }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the 30-day window reaches every provider that supports one", () => {
  it("gnews receives a from= date", async () => {
    const { fetchGnews } = await import("@/lib/news/gnews");
    await fetchGnews("fraud detection", { max: 10, days: 30 });
    expect(calls.join()).toMatch(/[?&]from=\d{4}-\d{2}-\d{2}/);
  });

  it("serper receives a past-month time range", async () => {
    const { fetchSerper } = await import("@/lib/news/serper");
    await fetchSerper("fraud detection", { days: 30 });
    expect(calls.join()).toMatch(/qdr%3Am|qdr:m/);
  });
});
