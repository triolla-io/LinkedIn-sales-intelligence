import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export async function checkDailyLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { allowed: true };
  const ratelimit = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(20, "24 h"),
    prefix: "msg",
  });
  const { success, reset } = await ratelimit.limit(userId);
  if (success) return { allowed: true };
  return { allowed: false, retryAfter: Math.ceil((reset - Date.now()) / 1000) };
}

export async function checkSpacingLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { allowed: true };
  const ratelimit = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.fixedWindow(1, "3 m"),
    prefix: "msg-spacing",
  });
  const { success, reset } = await ratelimit.limit(userId);
  if (success) return { allowed: true };
  return { allowed: false, retryAfter: Math.ceil((reset - Date.now()) / 1000) };
}
