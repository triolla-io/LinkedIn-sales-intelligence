"use client";

import Link from "next/link";
import { Users, Upload, ArrowLeft } from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";
import { ApprovalsTab } from "@/app/(dashboard)/routine/radar/approvals-tab";
import { Num } from "@/components/ui/text";

/**
 * "היום" — דף הבית.
 *
 * מה השתנה: הדשבורד הקודם פתח בספירת אנשי קשר ובייבוא CSV מלפני 54 יום,
 * בעוד הדבר היחיד שיובל נכנס בשבילו — ההודעות שממתינות לאישור — היה קבור
 * שמונה פריטי ניווט למטה. עכשיו המסך פותח במה שדורש החלטה, ומצב הנתונים
 * ירד לשורת רקע בתחתית: מידע שנכון להחזיק, לא מה שפותחים בשבילו את הבוקר.
 */

interface Props {
  user: { name: string; email: string; image?: string | null };
  contactCount: number;
  latestImport: {
    fileName: string;
    added: number;
    updated: number;
    removed: number;
    createdAt: string;
  } | null;
}

/**
 * זמן יחסי בעברית — כולל צורת זוגי ("לפני חודשיים") ויחיד בלי המספר.
 * הפורמט הקודם ייצר "לפני 1 חודשים".
 */
function formatRelative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
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

export default function DashboardClient({ contactCount, latestImport }: Props) {
  const today = new Date().toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div dir="rtl" className="min-h-full bg-[var(--background)]">
      <AutoRefresher />

      <div className="mx-auto max-w-[860px] px-5 pb-24 pt-8 sm:px-8">
        {/* התאריך הוא ההקשר היחיד שהמסך צריך מעל הסיפור */}
        <p className="type-eyebrow mb-5">{today}</p>

        {/* הפתיח הנרטיבי, הבועות והשקט — כולם מגיעים מכאן */}
        <ApprovalsTab />

        {/* ---------- מצב הנתונים: רקע, לא כותרת ---------- */}
        <footer className="mt-14 border-t border-[var(--line)] pt-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-[var(--muted)]">
            <Link
              href="/contacts"
              className="fv-ring group inline-flex items-center gap-1.5 rounded-md py-0.5 transition-colors hover:text-[var(--accent)]"
            >
              <Users className="size-3.5 text-[var(--faint)] transition-colors group-hover:text-[var(--accent)]" />
              <Num>{contactCount.toLocaleString("he-IL")}</Num> אנשי קשר
              <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>

            <span className="text-[var(--line)]" aria-hidden>
              |
            </span>

            {latestImport ? (
              <Link
                href="/import"
                className="fv-ring group inline-flex items-center gap-1.5 rounded-md py-0.5 transition-colors hover:text-[var(--accent)]"
              >
                <Upload className="size-3.5 text-[var(--faint)] transition-colors group-hover:text-[var(--accent)]" />
                ייבוא אחרון {formatRelative(latestImport.createdAt)} · נוספו{" "}
                <Num>{latestImport.added.toLocaleString("he-IL")}</Num>
                <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ) : (
              <Link
                href="/import"
                className="fv-ring inline-flex items-center gap-1.5 rounded-md py-0.5 text-[var(--accent)]"
              >
                <Upload className="size-3.5" />
                עוד לא ייבאת אנשי קשר — להתחיל כאן
              </Link>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
