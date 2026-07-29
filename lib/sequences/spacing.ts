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

/** Assign a 0-based index to each step among the steps that share its (dayOffset, start time, end time). */
export function assignWindowIndices<
  T extends {
    dayOffset: number;
    sendHour: number;
    sendMinute?: number;
    sendHourEnd: number | null;
    sendMinuteEnd?: number;
  }
>(orderedSteps: T[]): Array<T & { indexInWindow: number }> {
  const counters = new Map<string, number>();
  return orderedSteps.map((step) => {
    const start = step.sendHour * 60 + (step.sendMinute ?? 0);
    const end = step.sendHourEnd === null ? "null" : step.sendHourEnd * 60 + (step.sendMinuteEnd ?? 0);
    const key = `${step.dayOffset}|${start}|${end}`;
    const idx = counters.get(key) ?? 0;
    counters.set(key, idx + 1);
    return { ...step, indexInWindow: idx };
  });
}
