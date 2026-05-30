export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function uniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function humanDelay(meanMs: number, jitter = 0.5): number {
  const u = (Math.random() + Math.random()) / 2;
  return Math.max(20, meanMs * (1 - jitter + u * 2 * jitter));
}

export async function humanPause(minMs: number, maxMs: number): Promise<void> {
  await sleep(uniform(minMs, maxMs));
}
