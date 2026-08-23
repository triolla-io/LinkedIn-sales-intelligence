import { Redis } from "@upstash/redis";

export type NewsProvider = "tavily" | "gnews" | "serper" | "serpapi";

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
    case "serpapi":
      // SerpApi bills per search against a plan quota; hold ourselves below it.
      return { monthly: num(process.env.SERPAPI_MONTHLY_CAP, 1500) };
  }
}

function dayKey(provider: NewsProvider, iso: string): string {
  return `li:news:${provider}:d:${iso.slice(0, 10)}`; // YYYY-MM-DD
}

function monthKey(provider: NewsProvider, iso: string): string {
  return `li:news:${provider}:m:${iso.slice(0, 7)}`; // YYYY-MM
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
    const key = dayKey(provider, iso);
    const count = await redis.incr(key);
    await redis.expire(key, 2 * 24 * 60 * 60); // 2 days — outlives the day window
    if (count > daily) {
      // Give the increment back. Without this the counter measures ATTEMPTS, not usage:
      // once over cap every refused reservation still raised it, so Tavily read 2,174
      // against a 950 cap while only ~950 real calls had ever been made. A number that
      // cannot come back down is a number nobody can act on.
      await redis.decr(key);
      return false;
    }
  }
  if (monthly != null) {
    const key = monthKey(provider, iso);
    const count = await redis.incr(key);
    await redis.expire(key, 35 * 24 * 60 * 60); // ~35 days — outlives the month window
    if (count > monthly) {
      await redis.decr(key);
      return false;
    }
  }
  return true;
}

export type QuotaStatus = {
  provider: NewsProvider;
  /** "none" means we cannot know — Redis is absent and reservations fail open. */
  window: "day" | "month" | "none";
  used: number;
  cap: number | null;
  remaining: number | null;
};

/**
 * How much of a provider's window is spent, WITHOUT spending any of it.
 *
 * `reserveNewsCall` increments, so it cannot answer this question — a pre-flight check
 * built on it would charge a search for every check.
 *
 * Reports `window: "none"` rather than "unlimited" when Redis is absent: reservations
 * fail open there, so we genuinely do not know, and a gate that reads unknown as fine
 * is worse than no gate because it looks like it checked.
 */
export async function newsQuotaStatus(provider: NewsProvider): Promise<QuotaStatus> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { provider, window: "none", used: 0, cap: null, remaining: null };
  }
  const redis = Redis.fromEnv();
  const { daily, monthly } = capsFor(provider);
  const iso = new Date().toISOString();
  const window = daily != null ? "day" : "month";
  const cap = daily ?? monthly ?? null;
  const raw = await redis.get<number | string | null>(daily != null ? dayKey(provider, iso) : monthKey(provider, iso));
  const n = Number(raw ?? 0);
  const used = Number.isFinite(n) && n > 0 ? n : 0;
  return { provider, window, used, cap, remaining: cap == null ? null : Math.max(0, cap - used) };
}
