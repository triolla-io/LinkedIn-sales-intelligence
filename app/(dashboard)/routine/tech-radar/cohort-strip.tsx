"use client";

import { MIN_STAFF, MAX_STAFF, type CohortCounts } from "@/lib/tech-radar/cohort";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";

export type CohortStripCounts = CohortCounts & { employers: number; noEmployer: number };

/**
 * Gate 3 of the staged ascent, made visible.
 *
 * Deliberately shows the EXCLUSIONS, not just the cohort: a wrong cohort size is
 * cheap to fix here and expensive to discover after a scan has spent tokens on
 * the wrong people. `size_unknown` is framed as a backlog because that is what
 * it is — those contacts are wanted, we just cannot size their employer yet.
 *
 * Imports only lib/tech-radar/cohort (pure). Importing the prisma-backed
 * population module here would break `next build`.
 *
 * `ui.ts` has no dedicated "muted text" token, so this matches the raw-Tailwind
 * convention already used for muted/secondary text elsewhere in this same
 * client (tech-radar-client.tsx uses `text-[#9b9895]` for this purpose).
 */
export function CohortStrip({ counts }: { counts: CohortStripCounts }) {
  const included = counts.cohort + counts.opt_in;

  return (
    <section className={cn(ui.card, "p-4")} dir="rtl" aria-label="מצב הקוהורטה">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <span className="text-2xl font-semibold text-[#1a1917]">{included}</span>
          <span className="text-[#9b9895]"> אנשי קשר בקוהורטה</span>
        </div>
        <div className="text-xs text-[#9b9895]">
          {counts.employers} מעסיקים · {counts.opt_in} נוספו ידנית · {counts.opt_out} הוחרגו ידנית
        </div>
      </div>

      {included === 0 && (
        <p className="text-xs text-[#9b9895] mt-2">
          אין אף איש קשר בקוהורטה. מתוך {counts.total} אנשי קשר: {counts.opt_out} הוחרגו ידנית,{" "}
          {counts.not_clevel} אינם C-level, {counts.size_out_of_range} בחברות מחוץ לטווח{" "}
          {MIN_STAFF}–{MAX_STAFF}, {counts.size_unknown} חסרי נתון גודל, ו-{counts.noEmployer}{" "}
          בלי שם מעסיק תקין.
        </p>
      )}

      {counts.size_unknown > 0 && (
        <p className="text-xs text-[#9b9895] mt-2">
          {counts.size_unknown} אנשי קשר C-level ממתינים לנתון גודל חברה — הם לא נפסלו.
          העשרת החברות שלהם תגדיל את הקוהורטה.
        </p>
      )}

      {counts.noEmployer > 0 && (
        <p className="text-xs text-[#9b9895] mt-2">
          {counts.noEmployer} אנשי קשר בקוהורטה בלי שם מעסיק תקין — אי אפשר לשייך אותם לחברה, ולכן
          הם לא ייחקרו.
        </p>
      )}
    </section>
  );
}
