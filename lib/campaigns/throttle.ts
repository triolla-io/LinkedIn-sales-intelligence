import { Redis } from "@upstash/redis";

const UPSTASH_CONFIGURED = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const HOUR_LIMIT = 20;
const DAY_LIMIT  = 80;

export type QuotaResult = { ok: true } | { ok: false; retryAfterSec: number; reason: "hour" | "day" };

export async function checkSendQuota(userId: string): Promise<QuotaResult> {
  if (!UPSTASH_CONFIGURED) return { ok: true };
  const redis = Redis.fromEnv();
  const hourKey = `li:send:${userId}:h:${Math.floor(Date.now() / 3_600_000)}`;
  const dayKey  = `li:send:${userId}:d:${Math.floor(Date.now() / 86_400_000)}`;

  const [hourCount, dayCount] = await Promise.all([redis.incr(hourKey), redis.incr(dayKey)]);
  await Promise.all([redis.expire(hourKey, 3600), redis.expire(dayKey, 86400)]);

  if (hourCount > HOUR_LIMIT) {
    const ms = 3_600_000 - (Date.now() % 3_600_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "hour" };
  }
  if (dayCount > DAY_LIMIT) {
    const ms = 86_400_000 - (Date.now() % 86_400_000);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000), reason: "day" };
  }
  return { ok: true };
}

export function jitterSeconds(): number {
  return 45 + Math.floor(Math.random() * 76); // 45–120s
}
