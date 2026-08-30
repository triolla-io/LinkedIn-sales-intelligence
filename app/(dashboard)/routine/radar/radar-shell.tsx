"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { PeopleTab } from "./people-tab";
import { DecisionsTab } from "./decisions-tab";

/**
 * הקליפה של /routine/radar — שני טאבים: אנשים ומסלול ההחלטות.
 *
 * "לאישור שלך" כבר לא גר כאן: מסך הבית ("היום") הוא-הוא תור האישורים,
 * וכשהטאב הזה חי גם כאן, לחיצה על "ראדאר קשרים" נחתה על תוכן שנראה
 * זהה לעמוד הבית — והרגישה כמו באג. לינקים ישנים ל-?tab=approvals
 * מופנים הביתה, ששם התוכן הזה באמת גר.
 *
 * הטאב הפעיל חי ב-?tab= כדי שלינק יוכל לנחות בכל מקום.
 */

const TABS = [
  { key: "people", label: "אנשים" },
  { key: "decisions", label: "מסלול ההחלטות" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function RadarShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get("tab");
  const legacyApprovals = raw === "approvals";
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "people";
  const machine = tab === "decisions";

  useEffect(() => {
    if (legacyApprovals) router.replace("/dashboard");
  }, [legacyApprovals, router]);
  if (legacyApprovals) return null;

  return (
    <div
      dir="rtl"
      className={cn(
        "min-h-full flex-1 text-[var(--foreground)] transition-colors",
        machine ? "bg-[var(--surface-secondary)]" : "bg-[var(--background)]",
      )}
    >
      <div className="mx-auto max-w-[880px] px-4 pb-20 pt-6 sm:px-6">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="type-h2 text-[var(--foreground)]">ראדאר קשרים</h1>
            <span className="type-num text-[13px] text-[var(--faint)]">
              {new Date().toLocaleDateString("he-IL", {
                weekday: "long",
                day: "numeric",
                month: "numeric",
              })}
            </span>
          </div>

          <nav
            className="flex rounded-full bg-[var(--surface-secondary)] p-[3px]"
            role="tablist"
            aria-label="טאבים"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => router.replace(`/routine/radar?tab=${t.key}`, { scroll: false })}
                className={cn(
                  "fv-ring rounded-full px-3.5 py-[7px] text-[13px] font-semibold transition-all sm:px-[18px] sm:text-[13.5px]",
                  tab === t.key
                    ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-paper)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {tab === "people" && <PeopleTab />}
        {tab === "decisions" && <DecisionsTab />}
      </div>
    </div>
  );
}
