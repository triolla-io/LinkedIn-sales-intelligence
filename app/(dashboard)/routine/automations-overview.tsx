"use client";

import Link from "next/link";
import useSWR from "swr";
import { Switch } from "@heroui/react";
import {
  Search, PartyPopper, Sparkles, Newspaper, Radar, Route as RouteIcon,
  ArrowLeft, Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher } from "@/lib/fetcher";
import { Chip } from "@/components/ui/chip";

/**
 * אוטומציות — דף הבית של האזור.
 *
 * הבעיה שהוא פותר: קודם, לחיצה על הקבוצה בניווט זרקה ישר לתוך "מסלול
 * ההחלטות" — מסך הכיול הכי טכני במערכת — בלי שום מבט-על. מי שלא בנה את
 * המערכת לא ידע מה רץ בכלל, מה כבוי, ומה כל דבר עושה.
 *
 * העיצוב: כרטיס לכל אוטומציה, ולכל אחד שלוש תשובות בגובה העיניים —
 * מה זה עושה (במילים של בן אדם, לא של המערכת), האם זה דולק (מתג חי),
 * ולאן נכנסים. בלי טלמטריה — המספרים גרים בפנים, בכל מסך.
 */

type ModuleKey = "connections" | "jobChecks" | "companySignals" | "fintechRadar" | "techRadar";

type ModuleState = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
  companySignalsEnabled: boolean;
  fintechRadarEnabled: boolean;
  techRadarEnabled: boolean;
};

const AUTOMATIONS: {
  key: ModuleKey;
  stateField: keyof ModuleState;
  href: string;
  label: string;
  /** מה זה עושה — משפט אחד, בלי ז'רגון */
  what: string;
  icon: typeof Search;
}[] = [
  {
    key: "connections",
    stateField: "connectionsEnabled",
    href: "/routine/connections",
    label: "בקשות חברות",
    what: "מאתרת בכירים לפי תפקיד ושולחת להם בקשות חברות בלינקדאין, בקצב אנושי.",
    icon: Search,
  },
  {
    key: "jobChecks",
    stateField: "jobChecksEnabled",
    href: "/routine/job-changes",
    label: "עדכוני משתמשים",
    what: "עוקבת אחרי אנשי הקשר ומזהה מי החליף תפקיד או חברה — הזדמנות לומר מזל טוב.",
    icon: PartyPopper,
  },
  {
    key: "companySignals",
    stateField: "companySignalsEnabled",
    href: "/routine/company-signals",
    label: "חדשות חברות",
    what: "סורקת חדשות על החברות של אנשי הקשר ומכינה טיוטת ברכה כשקורה אצלם משהו גדול.",
    icon: Sparkles,
  },
  {
    key: "fintechRadar",
    stateField: "fintechRadarEnabled",
    href: "/routine/fintech-radar",
    label: "ראדאר פינטק",
    what: "אוספת חדשות פינטק שבועיות ומציעה למי מאנשי הקשר כל ידיעה יכולה להיות מעניינת.",
    icon: Newspaper,
  },
  {
    key: "techRadar",
    stateField: "techRadarEnabled",
    href: "/routine/tech-radar",
    label: "ראדאר טכנולוגי",
    what: "החדשה במשפחה: קוראת כתבות דרך העיניים של כל איש קשר, ומנסחת ׳ראיתי וחשבתי עליך׳.",
    icon: Radar,
  },
];

export function AutomationsOverview() {
  const { data, mutate, isLoading } = useSWR<ModuleState>("/api/routine/modules", fetcher);

  async function toggle(module: ModuleKey, enabled: boolean) {
    // עדכון אופטימי — המתג מגיב מיד, השרת מאשר אחר כך
    const field = AUTOMATIONS.find((a) => a.key === module)!.stateField;
    await mutate(
      async () => {
        const r = await fetch("/api/routine/modules", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module, enabled }),
        });
        return r.json();
      },
      { optimisticData: data ? { ...data, [field]: enabled } : undefined, rollbackOnError: true },
    );
  }

  return (
    <div dir="rtl" className="min-h-full bg-[var(--background)]">
      <div className="mx-auto max-w-[860px] px-5 pb-24 pt-8 sm:px-8">
        <h1 className="type-h1 mb-1">אוטומציות</h1>
        <p className="mb-8 max-w-[48ch] text-[15px] text-[var(--muted)]">
          כל מה שרץ כאן לבד. מתג לכל אוטומציה, והסבר במשפט אחד — נכנסים פנימה כדי
          לראות מה היא מצאה ולמה.
        </p>

        <div className="flex flex-col gap-3">
          {AUTOMATIONS.map((a) => {
            const Icon = a.icon;
            const on = data?.[a.stateField] ?? false;
            return (
              <div
                key={a.key}
                className="group flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-paper)] transition-colors hover:border-[var(--accent)]/40 sm:p-5"
              >
                <div
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-lg transition-colors",
                    on ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-secondary)] text-[var(--faint)]",
                  )}
                >
                  <Icon className="size-5" />
                </div>

                <Link href={a.href} className="fv-ring min-w-0 flex-1 rounded-md">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-[var(--foreground)]">{a.label}</span>
                    {!on && !isLoading && <Chip>כבויה</Chip>}
                    <ArrowLeft className="size-3.5 text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="mt-0.5 block text-[13.5px] leading-relaxed text-[var(--muted)]">
                    {a.what}
                  </span>
                </Link>

                {isLoading ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-[var(--faint)]" aria-hidden />
                ) : (
                  <Switch
                    size="sm"
                    isSelected={on}
                    onChange={(v: boolean) => toggle(a.key, v)}
                    aria-label={`הפעלת ${a.label}`}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                )}
              </div>
            );
          })}
        </div>

        {/* לא אוטומציות — אבל גרים באותו אזור */}
        <div className="mt-8 flex flex-col gap-2 border-t border-[var(--line)] pt-6">
          <Link
            href="/routine/radar?tab=decisions"
            className="fv-ring group flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
          >
            <RouteIcon className="size-4 text-[var(--faint)] transition-colors group-hover:text-[var(--accent)]" />
            <span>
              <b className="font-semibold text-[var(--foreground)]">מסלול ההחלטות</b> — למה כל
              כתבה עברה או נעצרה בדרך לטיוטה
            </span>
            <ArrowLeft className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </div>
      </div>
    </div>
  );
}
