/**
 * Why a person got nothing this week, in priority order. A quiet day must read as a
 * decision, not a bug — this is the single place that decision is derived, used by the
 * approvals API (which maps it to Hebrew copy).
 *
 * Pure and prisma-free ON PURPOSE: person-scan.ts imports prisma, so the cooldown
 * constant is duplicated here rather than imported — importing it would drag prisma
 * into anything that touches this file. The two constants are pinned to each other by
 * the test in tests/unit/radar-quiet.test.ts and by this comment.
 */

/** MUST equal MIN_DAYS_BETWEEN_MESSAGES in lib/tech-radar/person-scan.ts. */
export const QUIET_COOLDOWN_DAYS = 7;

export type QuietReason =
  | { kind: "waiting"; daysSinceMessage: number }
  | { kind: "all_vetoed"; count: number }
  | { kind: "no_material" };

export function deriveQuietReason(input: {
  lastMessageAt: Date | null;
  vetoedThisWeek: number;
  now: Date;
}): QuietReason {
  if (input.lastMessageAt) {
    const days = Math.floor((input.now.getTime() - input.lastMessageAt.getTime()) / 864e5);
    if (days < QUIET_COOLDOWN_DAYS) return { kind: "waiting", daysSinceMessage: days };
  }
  if (input.vetoedThisWeek > 0) return { kind: "all_vetoed", count: input.vetoedThisWeek };
  return { kind: "no_material" };
}
