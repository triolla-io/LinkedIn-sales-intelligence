"use client";

import AutoRefresher from "@/components/auto-refresher";
import { ApprovalsTab } from "@/app/(dashboard)/routine/radar/approvals-tab";
import { TodayOverview, type TodayOverviewProps } from "@/components/dashboard/today-overview";

/**
 * "היום" — דף הבית.
 *
 * מה השתנה: הדשבורד הקודם פתח בספירת אנשי קשר ובייבוא CSV מלפני 54 יום,
 * בעוד הדבר היחיד שיובל נכנס בשבילו — ההודעות שממתינות לאישור — היה קבור
 * שמונה פריטי ניווט למטה. עכשיו המסך פותח במה שדורש החלטה.
 *
 * ומתחת: ביום שקט המסך היה נגמר שם, ונשאר שדה ריק שנקרא כמו אפליקציה
 * תקועה. מבט־העל ממלא את המקום הזה בהקשר — מי ברשת, מה קרה, וכמה קשר
 * יצרת — בלי להתחרות על תשומת הלב עם ההחלטה שלמעלה.
 */

interface Props {
  user: { name: string; email: string; image?: string | null };
  overview: TodayOverviewProps;
}

export default function DashboardClient({ overview }: Props) {
  const today = new Date().toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div dir="rtl" className="min-h-full bg-[var(--background)]">
      <AutoRefresher />

      <div className="mx-auto max-w-[1080px] px-5 pb-24 pt-8 sm:px-8">
        {/* עמודת הקריאה של סיפור הבוקר נשארת ברוחב שלה — מבט־העל רחב ממנה */}
        <div className="mx-auto max-w-[860px]">
          {/* התאריך הוא ההקשר היחיד שהמסך צריך מעל הסיפור */}
          <p className="type-eyebrow mb-5">{today}</p>

          {/* הפתיח הנרטיבי, הבועות והשקט — כולם מגיעים מכאן */}
          <ApprovalsTab />
        </div>

        <TodayOverview {...overview} />
      </div>
    </div>
  );
}
