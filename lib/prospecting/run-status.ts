export function computeRunStatusSummary(input: {
  status: string;
  pausedUntil: Date | null;
  nextScheduledFor: Date | null;
  sentToday: number;
  dailyCap: number;
  sentThisWeek: number;
  weeklyCap: number;
  now: Date;
}): { state: "frozen" | "paused" | "completed" | "daily_cap" | "weekly_cap" | "waiting" | "idle"; message: string; nextAt: string | null } {
  if (input.status === "COMPLETED") return { state: "completed", message: "הריצה הושלמה", nextAt: null };
  if (input.pausedUntil && input.pausedUntil > input.now)
    return { state: "frozen", message: `החשבון מוקפא עד ${input.pausedUntil.toISOString()}`, nextAt: input.pausedUntil.toISOString() };
  if (input.status === "PAUSED") return { state: "paused", message: "הריצה מושהית", nextAt: null };
  if (input.sentToday >= input.dailyCap)
    return { state: "daily_cap", message: "הגעת למכסה היומית — ימשיך מחר", nextAt: null };
  if (input.sentThisWeek >= input.weeklyCap)
    return { state: "weekly_cap", message: "הגעת למכסה השבועית — ימשיך בשבוע הבא", nextAt: null };
  if (input.nextScheduledFor)
    return { state: "waiting", message: `הבקשה הבאה תישלח ב-${input.nextScheduledFor.toISOString()}`, nextAt: input.nextScheduledFor.toISOString() };
  return { state: "idle", message: "ממתין למועמדים / לפעילות התוסף", nextAt: null };
}
