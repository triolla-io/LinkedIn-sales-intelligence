import { Redis } from "@upstash/redis";

export type NewsProvider = "tavily" | "gnews" | "serper";

/**
 * Per-provider free-tier windows and the caps we hold ourselves to (below each real
 * limit, so the free quota lasts the whole month):
 *   • GNews  — 100 requests/DAY free   → daily cap (default 90).
 *   • Tavily — ~1,000 searches/MONTH   → monthly cap (default 950).
 *   • Serper — pay-per-query (~$0.001) → monthly cap as a $ ceiling (default 1,500 ≈ $1.50).
 * Each cap is env-overridable. A window left undefined for a provider is unbounded.
 */
function capsFor(provider: NewsProvider): { daily?: number; monthly?: number } {
  const num = (v: string | undefined, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  switch (provider) {
    case "gnews":
      return { daily: num(process.env.GNEWS_DAILY_CAP, 90) };
    case "tavily":
      return { monthly: num(process.env.TAVILY_MONTHLY_CAP, 950) };
    case "serper":
      return { monthly: num(process.env.SERPER_MONTHLY_CAP, 1500) };
  }
}

/**
 * Reserve one call against a news provider's budget. Increments a Redis counter for
 * the current day and/or month and returns false once the cap is reached — callers
 * then skip the call (returning []), so we never blow past the free quota mid-month.
 *
 * Fail-open: if Upstash Redis is not configured, always allow (mirrors
 * lib/mcp/rate-limit.ts). Incrementing before the call is deliberate — we would
 * rather slightly under-use the quota than risk exceeding it.
 */
export async function reserveNewsCall(provider: NewsProvider): Promise<boolean> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return true;
  const redis = Redis.fromEnv();
  const { daily, monthly } = capsFor(provider);
  const iso = new Date().toISOString();

  if (daily != null) {
    const key = `li:news:${provider}:d:${iso.slice(0, 10)}`; // YYYY-MM-DD
    const count = await redis.incr(key);
    await redis.expire(key, 2 * 24 * 60 * 60); // 2 days — outlives the day window
    if (count > daily) return false;
  }
  if (monthly != null) {
    const key = `li:news:${provider}:m:${iso.slice(0, 7)}`; // YYYY-MM
    const count = await redis.incr(key);
    await redis.expire(key, 35 * 24 * 60 * 60); // ~35 days — outlives the month window
    if (count > monthly) return false;
  }
  return true;
}
