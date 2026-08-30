/**
 * זמן יחסי בעברית — כולל צורת זוגי ("לפני חודשיים") ויחיד בלי המספר.
 * הפורמט הנאיבי ייצר "לפני 1 חודשים".
 *
 * ישב קודם בתוך dashboard-client; הועלה לכאן כשמסך "היום" קיבל
 * פיד עדכונים שצריך בדיוק את אותו ניסוח.
 */
export function formatRelative(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return mins === 1 ? "לפני דקה" : `לפני ${mins} דקות`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? "לפני שעה" : hrs === 2 ? "לפני שעתיים" : `לפני ${hrs} שעות`;

  const days = Math.floor(hrs / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;

  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "לפני שבוע" : weeks === 2 ? "לפני שבועיים" : `לפני ${weeks} שבועות`;

  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "לפני חודש" : months === 2 ? "לפני חודשיים" : `לפני ${months} חודשים`;

  const years = Math.floor(months / 12);
  return years === 1 ? "לפני שנה" : years === 2 ? "לפני שנתיים" : `לפני ${years} שנים`;
}
