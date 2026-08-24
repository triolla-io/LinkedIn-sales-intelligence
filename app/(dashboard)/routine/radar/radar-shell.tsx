"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ApprovalsTab } from "./approvals-tab";
import { PeopleTab } from "./people-tab";
import { DecisionsTab } from "./decisions-tab";

/**
 * The three-tab shell of /routine/radar. Same data, two stories: the default tab is
 * Yuval's morning (approve/edit/skip), the decisions tab is Ariel's calibration view.
 * The active tab lives in ?tab= so a link can land anywhere.
 */

const TABS = [
  { key: "approvals", label: "לאישור שלך" },
  { key: "people", label: "אנשים" },
  { key: "decisions", label: "מסלול ההחלטות" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function RadarShell() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "approvals";

  return (
    <div dir="rtl" className="flex-1 min-h-full bg-[#faf8f4] text-[#1c2430]">
      <div className="max-w-[880px] mx-auto px-4 sm:px-6 pt-6 pb-20">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-7">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[19px] font-bold tracking-tight">ראדאר קשרים</h1>
            <span className="text-[13px] tabular-nums text-[rgba(28,36,48,0.5)]">
              {new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })}
            </span>
          </div>
          <nav className="flex bg-[rgba(28,36,48,0.05)] rounded-full p-[3px]" role="tablist" aria-label="טאבים">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => router.replace(`/routine/radar?tab=${t.key}`, { scroll: false })}
                className={cn(
                  "text-[13px] sm:text-[13.5px] font-semibold px-3.5 sm:px-[18px] py-[7px] rounded-full transition-all",
                  tab === t.key
                    ? "bg-white text-[#1c2430] shadow-[0_1px_3px_rgba(28,36,48,0.12)]"
                    : "text-[rgba(28,36,48,0.5)]"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {tab === "approvals" && <ApprovalsTab />}
        {tab === "people" && <PeopleTab />}
        {tab === "decisions" && <DecisionsTab />}
      </div>
    </div>
  );
}
