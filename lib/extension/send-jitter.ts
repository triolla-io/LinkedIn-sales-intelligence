// Randomized inter-message spacing for LinkedIn SEND tasks (STA-18).
// Pure module — no prisma imports (client bundles may reach it transitively).

export type JitterConfig = {
  minSeconds: number;
  maxSeconds: number;
  source: "env" | "default";
};

const DEFAULT_MIN_SECONDS = 45;
const DEFAULT_MAX_SECONDS = 180;

export function resolveJitterConfig(env: Record<string, string | undefined>): JitterConfig {
  const min = Number(env.MIN_DELAY_SECONDS);
  const max = Number(env.MAX_DELAY_SECONDS);
  const valid =
    env.MIN_DELAY_SECONDS !== undefined &&
    env.MAX_DELAY_SECONDS !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min > 0 &&
    max > 0 &&
    min < max;
  if (!valid) {
    if (env.MIN_DELAY_SECONDS !== undefined || env.MAX_DELAY_SECONDS !== undefined) {
      console.warn(
        `[send-jitter] invalid MIN_DELAY_SECONDS/MAX_DELAY_SECONDS (${env.MIN_DELAY_SECONDS}/${env.MAX_DELAY_SECONDS}), using defaults ${DEFAULT_MIN_SECONDS}/${DEFAULT_MAX_SECONDS}`
      );
    }
    return { minSeconds: DEFAULT_MIN_SECONDS, maxSeconds: DEFAULT_MAX_SECONDS, source: "default" };
  }
  return { minSeconds: min, maxSeconds: max, source: "env" };
}

/**
 * Gaussian delay over [min, max]: mean at the window center, sd = width/6
 * (±3σ spans the window), clamped so outliers never escape the range.
 */
export function sampleJitterSeconds(cfg: JitterConfig, rng: () => number = Math.random): number {
  const mean = (cfg.minSeconds + cfg.maxSeconds) / 2;
  const sd = (cfg.maxSeconds - cfg.minSeconds) / 6;
  // Box-Muller; guard u1=0 which would take log(0)
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const value = mean + z * sd;
  return Math.min(cfg.maxSeconds, Math.max(cfg.minSeconds, value));
}

/**
 * Next SEND slot: the delay is added on top of the latest of "now", the last
 * still-queued SEND, and the last completed SEND — so consecutive approvals
 * stack their delays instead of all landing at "now + jitter".
 */
export function computeJitteredScheduledFor(input: {
  now: Date;
  latestPendingScheduledFor: Date | null;
  latestCompletedAt: Date | null;
  delaySeconds: number;
}): Date {
  const base = Math.max(
    input.now.getTime(),
    input.latestPendingScheduledFor?.getTime() ?? 0,
    input.latestCompletedAt?.getTime() ?? 0
  );
  return new Date(base + input.delaySeconds * 1000);
}
