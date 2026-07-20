import { Redis } from "@upstash/redis";
import { hashToken } from "@/lib/mcp/tokens";

// 120 req/min per token: generous for normal MCP tool-call bursts (an agent
// chaining several tool calls per turn) while still bounding a leaked or
// guessed Bearer token to ~2 req/sec against the API.
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 120;

export type McpRateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

/** Fixed-window rate limit keyed on the (hashed) MCP Bearer token. */
export async function checkMcpRateLimit(tokenRaw: string): Promise<McpRateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return { ok: true };
  const redis = Redis.fromEnv();

  const windowIndex = Math.floor(Date.now() / WINDOW_MS);
  const key = `li:mcp:rl:${hashToken(tokenRaw)}:${windowIndex}`;

  const count = await redis.incr(key);
  await redis.expire(key, Math.ceil(WINDOW_MS / 1000));

  if (count > LIMIT_PER_WINDOW) {
    const ms = WINDOW_MS - (Date.now() % WINDOW_MS);
    return { ok: false, retryAfterSec: Math.ceil(ms / 1000) };
  }
  return { ok: true };
}
