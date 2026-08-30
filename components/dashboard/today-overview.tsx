"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Building2, Radar, Upload, UserRound, Users } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { AutoDir, Num } from "@/components/ui/text";
import { formatRelative } from "@/lib/relative-time";

/**
 * מבט־על למסך "היום" — מה שיושב מתחת לסיפור הבוקר.
 *
 * ההיגיון: הפריט היחיד שדורש החלטה (הודעות לאישור) הוא ה-ApprovalsTab שמעל.
 * כל מה שכאן הוא הקשר, לא משימה — ולכן אף מספר כאן לא לובש צבע של פעולה.
 * כל מספר נושא את ההשוואה שלו: מספר בלי הקשר הוא קישוט.
 *
 * המסך הזה נראה קודם כשדה ריק ביום שקט. מצב ריק כאן לעולם לא מציג "0" —
 * הוא מסביר *למה* הוא ריק ומה יקרה הלאה.
 */

export interface OverviewFeedItem {
  id: string;
  kind: "company" | "person";
  /** הכותרת כפי שהיא בדאטה — עשויה להיות עברית או אנגלית, ולכן AutoDir. */
  title: string;
  /** מקור + למי זה נוגע, כבר מנוסח בשרת. */
  source: string;
  at: string;
  isNew: boolean;
}

export interface TodayOverviewProps {
  contacts: { total: number; addedThisMonth: number; onRadar: number };
  companyUpdates: { total: number; fresh: number };
  peopleUpdates: { total: number; fresh: number };
  /** מספר האנשים (לא ההודעות) שיצרנו איתם קשר בכל תקופה. */
  outreach: { today: number; month: number; prevMonth: number; ytd: number };
  feed: OverviewFeedItem[];
  feedTotalThisWeek: number;
  latestImport: { createdAt: string; added: number } | null;
}

const he = (n: number) => n.toLocaleString("he-IL");

/* ── KPI ─────────────────────────────────────────────────────────────── */

function Kpi({
  icon: Icon,
  label,
  value,
  chip,
  children,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  chip?: { text: string; fresh: boolean };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-1 p-4">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--muted)]">
          <Icon className="size-3.5 text-[var(--faint)]" />
          {label}
        </span>
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="type-num text-2xl font-semibold leading-none">{he(value)}</span>
          {chip && <Chip tone={chip.fresh ? "accent" : "neutral"}>{chip.text}</Chip>}
        </span>
        <span className="mt-0.5 text-xs text-[var(--faint)]">{children}</span>
      </CardBody>
    </Card>
  );
}

/* ── פיד ─────────────────────────────────────────────────────────────── */

function Feed({ items, totalThisWeek }: { items: OverviewFeedItem[]; totalThisWeek: number }) {
  return (
    <Card className="flex h-full flex-col">
      <CardBody className="flex min-h-0 flex-1 flex-col p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="type-h2">מה קרה ברשת שלך</h2>
          {items.length > 0 && (
            <span className="text-xs text-[var(--faint)]">
              <Num>{he(totalThisWeek)}</Num> עדכונים השבוע
            </span>
          )}
        </div>

        {items.length === 0 ? (
          /* לא "0 עדכונים" — הסבר למה שקט ומה יקרה */
          <div className="flex flex-1 flex-col justify-center gap-1.5 py-6">
            <p className="type-h2 text-[var(--foreground)]">שקט ברשת השבוע</p>
            <p className="max-w-[46ch] text-sm text-[var(--muted)]">
              לא נמצאו גיוסים, מינויים או כתבות שנוגעים לאנשים שבמעקב. זו תוצאה של הסריקה, לא תקלה בה.
            </p>
            <p className="max-w-[46ch] text-sm text-[var(--faint)]">
              הסריקה הבאה תרוץ מחר בבוקר ותבדוק שוב.
            </p>
          </div>
        ) : (
          <ul className="mt-3 flex-1 divide-y divide-[var(--line)] overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="grid grid-cols-[16px_1fr_auto] items-baseline gap-3 py-2.5">
                <span className="translate-y-0.5 text-[var(--faint)]" aria-hidden>
                  {item.kind === "company" ? (
                    <Building2 className="size-3.5" />
                  ) : (
                    <UserRound className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <AutoDir as="span" className="text-[13.5px] font-medium">
                    {item.title}
                  </AutoDir>
                  {item.isNew && (
                    <Chip tone="accent" className="ms-2 align-[2px] px-2 py-0 text-[10px]">
                      חדש
                    </Chip>
                  )}
                  <AutoDir as="div" className="mt-0.5 text-xs text-[var(--muted)]">
                    {item.source}
                  </AutoDir>
                </span>
                <span className="text-[11.5px] whitespace-nowrap text-[var(--faint)]">
                  {formatRelative(item.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ── יצרת קשר ────────────────────────────────────────────────────────── */

const PERIODS = [
  { key: "today", label: "היום" },
  { key: "month", label: "החודש" },
  { key: "prevMonth", label: "חודש שעבר" },
  { key: "ytd", label: "מתחילת השנה" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

function Outreach({ outreach }: { outreach: TodayOverviewProps["outreach"] }) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const value = outreach[period];

  /* ההשוואה משתנה עם התקופה — מספר בלי הקשר הוא קישוט */
  const context: Record<PeriodKey, string> = {
    today: "אנשים היום",
    month: "אנשים החודש",
    prevMonth: "אנשים בחודש שעבר",
    ytd: "אנשים מתחילת השנה",
  };
  const delta =
    period === "month" && outreach.prevMonth > 0
      ? `${he(outreach.prevMonth)} בחודש שעבר`
      : period === "ytd"
        ? `ממוצע ${he(Math.round(outreach.ytd / (new Date().getMonth() + 1)))} בחודש`
        : null;

  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="type-h2">יצרת קשר</h2>
            <p className="mt-0.5 text-xs text-[var(--faint)]">הודעות שנשלחו בפועל</p>
          </div>
          <div
            role="group"
            aria-label="טווח זמן"
            className="inline-flex gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--neutral-soft)] p-0.5"
          >
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={
                  period === p.key
                    ? "fv-ring rounded-md bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] shadow-[var(--shadow-paper)]"
                    : "fv-ring rounded-md px-2.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {value === 0 ? (
          <p className="mt-3 max-w-[40ch] text-sm text-[var(--muted)]">
            {period === "today"
              ? "עוד לא יצרת קשר עם אף אחד היום."
              : "לא נשלחו הודעות בתקופה הזו."}
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-2.5">
              <span className="type-num text-[34px] leading-none font-semibold">{he(value)}</span>
              <span className="text-[13px] text-[var(--muted)]">{context[period]}</span>
            </div>
            {delta && <p className="mt-1 text-xs text-[var(--muted)]">{delta}</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── פוסט לינקדאין (בפיתוח) ──────────────────────────────────────────── */

function PostCard({ quietDay }: { quietDay: boolean }) {
  return (
    <Card className="border-dashed">
      <CardBody className="p-5">
        <Chip tone="warning" className="text-[10.5px]">
          בקרוב
        </Chip>
        <h2 className="type-h2 mt-2">
          {quietDay ? "יום שקט — זמן טוב לפוסט" : "פוסט חדש — לינקדאין"}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--faint)]">
          פוסט מהכתבות שהמערכת קראה השבוע, בקול שלך.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 cursor-default rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--surface)] opacity-45"
        >
          כתיבת פוסט
        </button>
      </CardBody>
    </Card>
  );
}

/* ── המסך ────────────────────────────────────────────────────────────── */

export function TodayOverview({
  contacts,
  companyUpdates,
  peopleUpdates,
  outreach,
  feed,
  feedTotalThisWeek,
  latestImport,
}: TodayOverviewProps) {
  return (
    <section className="mt-12 border-t border-[var(--line)] pt-7">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          icon={Users}
          label="אנשי קשר במעקב"
          value={contacts.total}
          chip={
            contacts.addedThisMonth > 0
              ? { text: `+${he(contacts.addedThisMonth)} החודש`, fresh: true }
              : undefined
          }
        >
          <Link href="/contacts" className="fv-ring group inline-flex items-center gap-1 hover:text-[var(--accent)]">
            <Radar className="size-3" />
            <Num>{he(contacts.onRadar)}</Num> בראדאר הפעיל
            <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </Kpi>

        <Kpi
          icon={Building2}
          label="עדכוני חברות"
          value={companyUpdates.total}
          chip={
            companyUpdates.fresh > 0
              ? { text: `${he(companyUpdates.fresh)} חדשים היום`, fresh: true }
              : { text: "אין חדשים היום", fresh: false }
          }
        >
          גיוסים, מוצרים, מהלכי חברה — 30 הימים האחרונים
        </Kpi>

        <Kpi
          icon={UserRound}
          label="עדכוני אנשים"
          value={peopleUpdates.total}
          chip={
            peopleUpdates.fresh > 0
              ? { text: `${he(peopleUpdates.fresh)} חדשים היום`, fresh: true }
              : { text: "אין חדשים היום", fresh: false }
          }
        >
          תפקידים חדשים ומעברי חברה — 30 הימים האחרונים
        </Kpi>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
        <Feed items={feed} totalThisWeek={feedTotalThisWeek} />
        <div className="flex flex-col gap-3">
          <Outreach outreach={outreach} />
          <PostCard quietDay={feed.length === 0} />
        </div>
      </div>

      {/* מצב הנתונים — רקע, לא כותרת */}
      <footer className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--muted)]">
        <Link
          href="/import"
          className="fv-ring group inline-flex items-center gap-1.5 rounded-md py-0.5 transition-colors hover:text-[var(--accent)]"
        >
          <Upload className="size-3.5 text-[var(--faint)] transition-colors group-hover:text-[var(--accent)]" />
          {latestImport ? (
            <>
              ייבוא אחרון {formatRelative(latestImport.createdAt)} · נוספו <Num>{he(latestImport.added)}</Num>
            </>
          ) : (
            <>עוד לא ייבאת אנשי קשר — להתחיל כאן</>
          )}
          <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      </footer>
    </section>
  );
}
