const TZ = "Asia/Jerusalem";

/** "בעוד 4 דקות (12:11)" / "היום בשעה 14:30" / "מחר בשעה 09:00" / "ב-5.7 בשעה 09:00" */
export function formatHebrewTime(d: Date, now: Date): string {
  const time = d.toLocaleTimeString("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const dayKey = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  const diffMin = Math.round((d.getTime() - now.getTime()) / 60000);
  if (diffMin >= 0 && diffMin < 60) {
    if (diffMin < 1) return `בעוד פחות מדקה (${time})`;
    if (diffMin === 1) return `בעוד דקה (${time})`;
    return `בעוד ${diffMin} דקות (${time})`;
  }
  if (dayKey(d) === dayKey(now)) return `היום בשעה ${time}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return `מחר בשעה ${time}`;
  const date = d.toLocaleDateString("he-IL", { timeZone: TZ, day: "numeric", month: "numeric" });
  return `ב-${date} בשעה ${time}`;
}

/** Human-readable Hebrew labels for extension error codes shown to end users. */
export const ERROR_CODE_LABELS: Record<string, string> = {
  no_connect: "כפתור 'התחבר' לא נמצא בפרופיל",
  connect_button_not_found: "כפתור 'התחבר' לא נמצא בפרופיל",
  follow_only: "בפרופיל יש רק כפתור 'עקוב' — דולג",
  already_or_blocked: "כבר מחוברים או שההצעה כבר ממתינה",
  already_connected: "כבר מחוברים",
  already_pending: "הצעת חברות כבר ממתינה",
  invitation_already_pending: "הצעת חברות כבר ממתינה",
  pending: "הצעת חברות כבר ממתינה",
  connected: "כבר מחוברים",
  checkpoint: "לינקדאין ביקשה אימות — החשבון הושהה זמנית",
  message_button_not_found: "כפתור השליחה לא נמצא",
  send_button_not_found: "כפתור השליחה לא נמצא",
  not_messageable: "לא ניתן לשלוח הודעה לאיש קשר זה",
  tab_load: "טעינת הדף נכשלה",
  tab_load_timeout: "טעינת הדף נכשלה (זמן קצוב)",
  tab_closed: "הטאב נסגר לפני סיום הפעולה",
  tab_create_failed: "פתיחת טאב חדש נכשלה",
  scrape_failed: "קריאת נתוני הפרופיל נכשלה",
  scrape_returned_null: "קריאת נתוני הפרופיל נכשלה",
  bad_payload: "שגיאה פנימית בנתוני המשימה",
  missing_payload: "שגיאה פנימית בנתוני המשימה",
  unknown_kind: "שגיאה פנימית בסוג המשימה",
  unknown: "שגיאה לא צפויה",
  // Discovery-time skip reasons (ConnectionRequest.skipReason)
  already_contact: "כבר קיים באנשי הקשר",
  pending_on_linkedin: "הצעת חברות כבר ממתינה (זוהה בחיפוש)",
  // Company-routine codes
  not_found: "החברה לא נמצאה בלינקדאין",
  no_id: "זיהוי מזהה החברה נכשל",
  search_failed: "החיפוש נכשל שוב ושוב — החברה סומנה ככושלת",
  unsupported_kind: "גרסת התוסף אינה תומכת בפעולה — נדרש עדכון",
  resolve_failed: "זיהוי החברה נכשל",
  ambiguous_match: "לא נמצאה חברה תואמת מספיק בלינקדאין",
  company_removed: "החברה הוסרה מהרוטינה",
};

export const TASK_KIND_LABELS: Record<string, string> = {
  CONNECT: "הצעת חברות",
  SEARCH: "חיפוש",
  CHECK_REPLY: "בדיקת תגובה",
  SEND_MESSAGE: "שליחת הודעה",
  RESOLVE_COMPANY: "זיהוי חברה",
};
