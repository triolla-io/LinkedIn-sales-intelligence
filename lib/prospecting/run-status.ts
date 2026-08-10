import { formatHebrewTime } from "@/lib/prospecting/format";

/** The extension polls continuously — quiet for this long means it is offline. */
export const EXTENSION_OFFLINE_AFTER_MS = 15 * 60 * 1000;

export function computeRunStatusSummary(input: {
  status: string;
  pausedUntil: Date | null;
  nextScheduledFor: Date | null;
  nextDiscoveryAt: Date | null;
  sentToday: number;
  dailyCap: number;
  sentThisWeek: number;
  weeklyCap: number;
  now: Date;
  /** Owner's extension last poll time; undefined = caller didn't check (skips the offline state). */
  extensionLastSeenAt?: Date | null;
}): { state: "frozen" | "paused" | "completed" | "daily_cap" | "weekly_cap" | "waiting" | "waiting_discovery" | "extension_offline" | "idle"; message: string; nextAt: string | null } {
  if (input.status === "COMPLETED") return { state: "completed", message: "הריצה הושלמה", nextAt: null };
  if (input.pausedUntil && input.pausedUntil > input.now)
    return { state: "frozen", message: `החשבון מוקפא עד ${formatHebrewTime(input.pausedUntil, input.now)}`, nextAt: input.pausedUntil.toISOString() };
  if (input.status === "PAUSED") return { state: "paused", message: "הריצה מושהית", nextAt: null };
  // A RUNNING run with a dead extension looks "active" while nothing actually happens —
  // surface that loudly before any "next send at…" promise that will never be kept.
  if (input.status === "RUNNING" && input.extensionLastSeenAt !== undefined) {
    const offline =
      input.extensionLastSeenAt === null ||
      input.now.getTime() - input.extensionLastSeenAt.getTime() > EXTENSION_OFFLINE_AFTER_MS;
    if (offline) {
      const sinceStr = input.extensionLastSeenAt
        ? input.extensionLastSeenAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
        : null;
      return {
        state: "extension_offline",
        message: sinceStr
          ? `התוסף לא מחובר (נראה לאחרונה ${sinceStr}) — בקשות וזיהוי ממתינים. פתחו את כרום עם התוסף כדי להמשיך`
          : "התוסף מעולם לא התחבר — התקינו ופתחו את תוסף הכרום כדי שהריצה תתקדם",
        nextAt: null,
      };
    }
  }
  if (input.sentToday >= input.dailyCap)
    return { state: "daily_cap", message: "הגעת למכסה היומית — ימשיך מחר", nextAt: null };
  if (input.sentThisWeek >= input.weeklyCap)
    return { state: "weekly_cap", message: "הגעת למכסה השבועית — ימשיך בשבוע הבא", nextAt: null };
  if (input.nextScheduledFor)
    return { state: "waiting", message: `הבקשה הבאה תישלח ${formatHebrewTime(input.nextScheduledFor, input.now)}`, nextAt: input.nextScheduledFor.toISOString() };
  // Recurring routine: the current pool is done, but the run is still active and will re-scan for
  // new people. Surface this as "active / waiting", NOT "completed".
  if (input.nextDiscoveryAt)
    return { state: "waiting_discovery", message: `כל המועמדים הנוכחיים טופלו — סריקה הבאה לאנשים חדשים ${formatHebrewTime(input.nextDiscoveryAt, input.now)}`, nextAt: input.nextDiscoveryAt.toISOString() };
  return { state: "idle", message: "ממתין למועמדים / לפעילות התוסף", nextAt: null };
}
