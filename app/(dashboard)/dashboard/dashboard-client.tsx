"use client";

import AutoRefresher from "@/components/auto-refresher";
import { ApprovalsTab } from "@/app/(dashboard)/routine/radar/approvals-tab";
import { TodayOverview, type TodayOverviewProps } from "@/components/dashboard/today-overview";
import { Num } from "@/components/ui/text";

/**
 * "היום" — דף הבית, במבנה דשבורד.
 *
 * מה השתנה: הגרסה הקודמת פתחה בכותרת נרטיבית ענקית ("בוקר טוב… אין הודעות")
 * שדחפה את כל המספרים מתחת לקו הגלילה, וביום שקט המסך נראה כמו מאמר ריק.
 * עכשיו הסיפור של הבוקר מצטמצם לשורת פתיחה אחת, אריח הפעולה נושא את ההחלטה,
 * וההודעות עצמן (כשיש) יושבות בסוף העמוד — ה-CTA הירוק מעגן אליהן.
 */

interface Props {
  user: { name: string; email: string; image?: string | null };
  overview: TodayOverviewProps;
}

function timeHe(iso: string): string {
  return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export default function DashboardClient({ user, overview }: Props) {
  const today = new Date().toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const firstName = user.name?.split(" ")[0] ?? "";
  const n = overview.action.pending.count;
  const freshCount = overview.companyUpdates.fresh + overview.peopleUpdates.fresh;

  const c = overview.postComments.count;

  const story =
    n === 0
      ? "אין הודעות שממתינות לאישור שלך"
      : n === 1
        ? "הודעה אחת שווה את הזמן שלך"
        : `${n.toLocaleString("he-IL")} הודעות שוות את הזמן שלך`;

  /* התגובות הן זרם נפרד מההודעות, ולכן משפט משלהן ולא חיבור לאותו מספר */
  const commentsStory =
    c === 0
      ? null
      : c === 1
        ? "תגובה אחת מוכנה לפוסט"
        : `${c.toLocaleString("he-IL")} תגובות מוכנות לפוסטים`;

  return (
    <div dir="rtl" className="min-h-full bg-[var(--background)]">
      <AutoRefresher />

      <div className="mx-auto max-w-[1560px] px-4 pb-16 pt-6 sm:px-6">
        {/* טופ-בר: שם המסך, הסיפור במשפט, וטריות הדאטה — שורה אחת */}
        <header className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-b border-[var(--line)] pb-4">
          <h1 className="type-h1 text-[26px]">היום</h1>
          <p className="text-[13.5px] text-[var(--muted)]">
            בוקר טוב{firstName ? `, ${firstName}` : ""} · {today} · {story}
            {commentsStory && <> · {commentsStory}</>}
            {freshCount > 0 && (
              <>
                {" "}
                · <Num>{freshCount.toLocaleString("he-IL")}</Num> עדכונים חדשים ברשת
              </>
            )}
          </p>
          <span className="ms-auto flex items-center gap-2 text-[12.5px] whitespace-nowrap text-[var(--muted)]">
            <span
              className="size-[7px] rounded-full bg-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]"
              aria-hidden
            />
            {overview.action.scan ? (
              <>
                עודכן ב־<Num>{timeHe(overview.action.scan.finishedAt)}</Num> · הסריקה הבאה מחר
              </>
            ) : (
              <>עוד לא רצה סריקה</>
            )}
          </span>
        </header>

        <TodayOverview {...overview} />

        {/* ההודעות עצמן — בועות לינקדאין הניתנות לעריכה, ורשימת "שקט השבוע".
            אריח הפעולה מעגן לכאן; ביום בלי כלום הסקשן פשוט לא מוצג. */}
        <section id="approvals" className="mx-auto mt-10 max-w-[860px] scroll-mt-6">
          <ApprovalsTab variant="embedded" />
        </section>
      </div>
    </div>
  );
}
