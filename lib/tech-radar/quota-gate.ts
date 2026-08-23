/**
 * Decide BEFORE a run whether its search quota can cover it.
 *
 * Written after the run that made it necessary. On 2026-08-23 a person-outward scan
 * issued 72 queries and returned `poolItems: 0` — not because the axes were wrong or the
 * filter too strict, but because Tavily's counter stood at 2,174 against a 950 cap and
 * GNews at 774 against 90. Both had been silently returning [] for weeks. The run looked
 * exactly like a feature failure and cost half a day to attribute.
 *
 * Pure: the caller reads the status, this does the arithmetic. So the same numbers can be
 * asserted in a test and rendered on a screen without touching Redis twice.
 */
import type { QuotaStatus } from "@/lib/news/budget";

/** fetchPoolNews retries once with a broadened query when a query returns nothing. */
const SEARCHES_PER_POOLED_QUERY = 2;

export type RunCost = { searches: number; breakdown: { research: number; scan: number } };

export function projectRunCost(input: { companiesToResearch: number; pooledQueries: number }): RunCost {
  const research = Math.max(0, input.companiesToResearch);
  const scan = Math.max(0, input.pooledQueries) * SEARCHES_PER_POOLED_QUERY;
  return { searches: research + scan, breakdown: { research, scan } };
}

export type QuotaVerdict =
  | { ok: true; needed: number; remaining: number | null }
  | { ok: false; needed: number; remaining: number | null; reason: string };

/**
 * Refuse rather than half-run. Once a cap trips every provider returns [], so a
 * partially funded run is indistinguishable from a quiet week — which is precisely the
 * ambiguity that hid the real problem.
 */
export function judgeQuota(needed: number, status: QuotaStatus): QuotaVerdict {
  if (needed <= 0) return { ok: true, needed: 0, remaining: status.remaining };

  if (status.remaining == null) {
    return {
      ok: false,
      needed,
      remaining: null,
      reason:
        "מכסת החיפושים לא נמדדת — UPSTASH_REDIS_REST_URL/TOKEN לא מוגדרים, ולכן קריאות לספקים לא נספרות. אין להריץ סריקה עד שהמדידה עובדת.",
    };
  }

  if (needed > status.remaining) {
    return {
      ok: false,
      needed,
      remaining: status.remaining,
      reason: `הריצה דורשת ${needed} חיפושים ב-${status.provider} ונשארו ${status.remaining} ל${
        status.window === "day" ? "יום" : "חודש"
      } הזה. ריצה חלקית מחזירה "לא נמצאו ידיעות" ואי אפשר להבדיל בינה לבין שבוע שקט, ולכן היא נעצרת לפני שהיא מתחילה.`,
    };
  }

  return { ok: true, needed, remaining: status.remaining };
}

/**
 * The providers a run can actually use right now, and the reason each unusable one is
 * out. A run needs at least ONE — and "which one died" is the difference between an
 * env fix and a code fix.
 */
export async function usableProviders(
  statuses: QuotaStatus[],
  needed: number
): Promise<{ usable: QuotaStatus[]; blocked: { provider: string; reason: string }[] }> {
  const usable: QuotaStatus[] = [];
  const blocked: { provider: string; reason: string }[] = [];
  for (const s of statuses) {
    const v = judgeQuota(needed, s);
    if (v.ok) usable.push(s);
    else blocked.push({ provider: s.provider, reason: v.reason });
  }
  return { usable, blocked };
}
