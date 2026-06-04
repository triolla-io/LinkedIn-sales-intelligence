export type QuotaInput = {
  sentToday: number;
  sentThisWeek: number;
  dailyCap: number;
  weeklyCap: number;
};

export type QuotaResult =
  | { canSendNow: true }
  | { canSendNow: false; deferReason: "daily" | "weekly" };

/** Daily cap is checked first so a same-day defer (resume tomorrow) wins over a week-long one. */
export function checkConnectQuota(i: QuotaInput): QuotaResult {
  if (i.sentToday >= i.dailyCap) return { canSendNow: false, deferReason: "daily" };
  if (i.sentThisWeek >= i.weeklyCap) return { canSendNow: false, deferReason: "weekly" };
  return { canSendNow: true };
}
