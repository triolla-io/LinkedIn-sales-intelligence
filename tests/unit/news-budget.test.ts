import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { incr, expire, decr } = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn(), decr: vi.fn() }));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({ incr, expire, decr }) },
}));

import { reserveNewsCall } from "@/lib/news/budget";

describe("reserveNewsCall", () => {
  beforeEach(() => {
    incr.mockReset();
    expire.mockReset();
    expire.mockResolvedValue(1);
    // A refused reservation gives its increment back, so the counter measures usage
    // rather than attempts. See reserveNewsCall.
    decr.mockReset();
    decr.mockResolvedValue(1);
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  });
  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.GNEWS_DAILY_CAP;
    delete process.env.TAVILY_MONTHLY_CAP;
  });

  it("fails OPEN (allows) when Redis is not configured — never blocks on misconfig", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(await reserveNewsCall("tavily")).toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });

  it("allows GNews while under the daily cap", async () => {
    process.env.GNEWS_DAILY_CAP = "90";
    incr.mockResolvedValueOnce(1);
    expect(await reserveNewsCall("gnews")).toBe(true);
  });

  it("blocks GNews once the daily cap is exceeded", async () => {
    process.env.GNEWS_DAILY_CAP = "90";
    incr.mockResolvedValueOnce(91);
    expect(await reserveNewsCall("gnews")).toBe(false);
  });

  it("blocks Tavily once the monthly cap is exceeded", async () => {
    process.env.TAVILY_MONTHLY_CAP = "950";
    incr.mockResolvedValueOnce(951);
    expect(await reserveNewsCall("tavily")).toBe(false);
  });

  it("counts GNews per-DAY and Tavily per-MONTH", async () => {
    incr.mockResolvedValue(1);
    await reserveNewsCall("gnews");
    expect(incr).toHaveBeenCalledWith(expect.stringMatching(/^li:news:gnews:d:\d{4}-\d{2}-\d{2}$/));
    incr.mockClear();
    await reserveNewsCall("tavily");
    expect(incr).toHaveBeenCalledWith(expect.stringMatching(/^li:news:tavily:m:\d{4}-\d{2}$/));
  });
});
