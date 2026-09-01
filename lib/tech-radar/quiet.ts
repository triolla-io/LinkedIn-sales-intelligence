/**
 * Why a person got nothing this week, in priority order. A quiet day must read as a
 * decision, not a bug — this is the single place that decision is derived, used by the
 * approvals API (which maps it to Hebrew copy).
 *
 * Pure and prisma-free ON PURPOSE: the cooldown constant is duplicated here rather than
 * imported — person-rank.ts, where it now lives, is prisma-free itself but is imported by
 * judge-and-draft.ts, and importing across that seam would drag prisma into anything that
 * touches this file. The two constants are pinned to each other by the test in
 * tests/unit/radar-quiet.test.ts and by this comment.
 */

/**
 * MUST equal MIN_DAYS_BETWEEN_MESSAGES in lib/tech-radar/person-rank.ts.
 *
 * That is the CANONICAL copy as of Phase B. person-scan.ts used to export a third,
 * unread copy of the same 7 — pacing moved to the send-release gate (evaluateRelease),
 * which lives in person-rank.ts, and a constant nothing reads is a number that drifts
 * without anyone noticing.
 */
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
