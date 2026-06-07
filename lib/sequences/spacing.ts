export const SAFE_GAP_MIN = 5; // fixed gap (minutes) between steps sharing a day+window

/** Position step `indexInWindow` within [windowStart, windowEnd]; clamp to windowEnd on overflow. */
export function spacedSlotMs(
  windowStartMs: number,
  windowEndMs: number | null,
  indexInWindow: number,
  gapMin: number = SAFE_GAP_MIN
): number {
  const slot = windowStartMs + indexInWindow * gapMin * 60_000;
  if (windowEndMs === null) return slot;
  return Math.min(slot, windowEndMs);
}

/** Assign a 0-based index to each step among the steps that share its (dayOffset, sendHour, sendHourEnd). */
export function assignWindowIndices<
  T extends { dayOffset: number; sendHour: number; sendHourEnd: number | null }
>(orderedSteps: T[]): Array<T & { indexInWindow: number }> {
  const counters = new Map<string, number>();
  return orderedSteps.map((step) => {
    const key = `${step.dayOffset}|${step.sendHour}|${step.sendHourEnd ?? "null"}`;
    const idx = counters.get(key) ?? 0;
    counters.set(key, idx + 1);
    return { ...step, indexInWindow: idx };
  });
}
