import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkSendQuota } from "@/lib/campaigns/throttle";

const incr = vi.fn();
const expire = vi.fn();
const get = vi.fn();

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({ incr, expire, get }) },
}));

describe("checkSendQuota", () => {
  beforeEach(() => {
    incr.mockReset(); expire.mockReset(); get.mockReset();
    process.env.UPSTASH_REDIS_REST_URL = "http://test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  it("returns ok when under both limits", async () => {
    incr.mockResolvedValueOnce(5).mockResolvedValueOnce(10);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res).toEqual({ ok: true });
  });

  it("returns retryAfter when hourly cap exceeded", async () => {
    incr.mockResolvedValueOnce(21).mockResolvedValueOnce(21);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.retryAfterSec).toBeGreaterThan(0);
  });

  it("returns retryAfter when daily cap exceeded", async () => {
    incr.mockResolvedValueOnce(5).mockResolvedValueOnce(81);
    expire.mockResolvedValue(1);
    const res = await checkSendQuota("user_1");
    expect(res.ok).toBe(false);
  });
});
