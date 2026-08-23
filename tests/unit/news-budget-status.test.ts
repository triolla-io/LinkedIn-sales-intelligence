import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
const incr = vi.fn();
const decr = vi.fn();
const expire = vi.fn();
vi.mock("@upstash/redis", () => ({ Redis: { fromEnv: () => ({ get, incr, decr, expire }) } }));

const { newsQuotaStatus, reserveNewsCall } = await import("@/lib/news/budget");

beforeEach(() => {
  for (const m of [get, incr, decr, expire]) m.mockReset();
  expire.mockResolvedValue(1);
  decr.mockResolvedValue(1);
  process.env.UPSTASH_REDIS_REST_URL = "https://x";
  process.env.UPSTASH_REDIS_REST_TOKEN = "t";
  delete process.env.TAVILY_MONTHLY_CAP;
  delete process.env.GNEWS_DAILY_CAP;
});

describe("newsQuotaStatus", () => {
  /** Asking must not spend. A status built on reserveNewsCall would cost a search per check. */
  it("reads the counter without incrementing it", async () => {
    get.mockResolvedValue(400);
    const s = await newsQuotaStatus("tavily");
    expect(incr).not.toHaveBeenCalled();
    expect(s).toEqual({ provider: "tavily", window: "month", used: 400, cap: 950, remaining: 550 });
  });

  it("treats an absent counter as zero used", async () => {
    get.mockResolvedValue(null);
    expect((await newsQuotaStatus("tavily")).remaining).toBe(950);
  });

  /** The state that actually occurred: 2,174 against a 950 cap. */
  it("never reports negative remaining once the cap is blown", async () => {
    get.mockResolvedValue(2174);
    const s = await newsQuotaStatus("tavily");
    expect(s.used).toBe(2174);
    expect(s.remaining).toBe(0);
  });

  it("uses the daily window for gnews", async () => {
    get.mockResolvedValue(10);
    const s = await newsQuotaStatus("gnews");
    expect(s.window).toBe("day");
    expect(s.cap).toBe(90);
  });

  /** Reservations fail open without Redis, so unknown must not read as unlimited. */
  it("reports unknown, not unlimited, when Redis is absent", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const s = await newsQuotaStatus("tavily");
    expect(s.window).toBe("none");
    expect(s.remaining).toBeNull();
  });
});

describe("reserveNewsCall", () => {
  it("allows and keeps the increment while under the cap", async () => {
    incr.mockResolvedValue(500);
    expect(await reserveNewsCall("tavily")).toBe(true);
    expect(decr).not.toHaveBeenCalled();
  });

  /**
   * The counter used to measure ATTEMPTS, not usage: once over cap, every refused
   * reservation still raised it, so Tavily read 2,174 against a 950 cap while only ~950
   * real calls had ever been made. A number that cannot come back down is a number
   * nobody can act on — and it made a working quota look permanently exhausted.
   */
  it("gives the increment back when it refuses", async () => {
    incr.mockResolvedValue(951);
    expect(await reserveNewsCall("tavily")).toBe(false);
    expect(decr).toHaveBeenCalledTimes(1);
  });

  it("allows exactly at the cap", async () => {
    incr.mockResolvedValue(950);
    expect(await reserveNewsCall("tavily")).toBe(true);
    expect(decr).not.toHaveBeenCalled();
  });

  it("gives back a refused daily reservation too", async () => {
    incr.mockResolvedValue(91);
    expect(await reserveNewsCall("gnews")).toBe(false);
    expect(decr).toHaveBeenCalledTimes(1);
  });

  /** Fails open with no Redis — mirrors lib/mcp/rate-limit.ts. */
  it("allows when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    expect(await reserveNewsCall("tavily")).toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });
});
