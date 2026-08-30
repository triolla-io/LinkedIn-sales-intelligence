"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Building2, Radar, Upload, UserRound, Users } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { AutoDir, Num } from "@/components/ui/text";
import { formatRelative } from "@/lib/relative-time";

/**
 * מבט־על למסך "היום" — הדשבורד עצמו.
 *
 * שורת הפתיחה: ארבעה אריחים, והראשון הוא היחיד שמותר לו ללבוש צבע פעולה —
 * "ממתינות למשלוח". כל השאר הקשר: מספר בלי השוואה הוא קישוט, ולכן כל אריח
 * נושא צ'יפ או שורת הקשר. הספרה 0 לא מוצגת לעולם — היא נקראת ככישלון מדיד,
 * אז כל אריח מחויב לנסח מה כתוב כשאין כלום (prop חובה `zero`).
 */

export interface OverviewFeedItem {
  id: string;
  kind: "company" | "person";
  /** הכותרת כפי שהיא בדאטה — עשויה להיות עברית או אנגלית, ולכן AutoDir. */
  title: string;
  source: string;
  at: string;
  isNew: boolean;
}

export interface ActionInfo {
  /** טיוטות שממתינות לאישור — הפעולה של המסך. */
  pending: { count: number; names: string[] };
  /** הסריקה האחרונה שהסתיימה, אם הייתה. */
  scan: { scanned: number; vetoed: number; finishedAt: string } | null;
}

export interface TodayOverviewProps {
  action: ActionInfo;
  contacts: { total: number; addedThisMonth: number; onRadar: number };
  companyUpdates: { total: number; fresh: number };
  peopleUpdates: { total: number; fresh: number };
  /** מספר האנשים (לא ההודעות) שיצרנו איתם קשר בכל תקופה. */
  outreach: { today: number; month: number; prevMonth: number; ytd: number };
  /** אנשים שנוצר איתם קשר, לפי שבוע — 8 השבועות האחרונים, הישן ראשון. */
  weekly: number[];
  feed: OverviewFeedItem[];
  feedTotalThisWeek: number;
  latestImport: { createdAt: string; added: number } | null;
}

const he = (n: number) => n.toLocaleString("he-IL");

/* ── אריח הפעולה — הדבר היחיד במסך שדורש החלטה ─────────────────────── */

function ActionTile({ action }: { action: ActionInfo }) {
  const { pending, scan } = action;

  if (pending.count > 0) {
    return (
      <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--accent)] bg-[var(--accent)] p-5 text-[var(--surface)] shadow-[var(--shadow-paper)]">
        <span className="text-[13px] font-medium opacity-75">ממתינות למשלוח</span>
        <span className="type-num mt-1 text-[34px] font-semibold leading-none">{he(pending.count)}</span>
        <AutoDir as="span" className="mt-1.5 truncate text-[12.5px] opacity-70">
          {pending.names.join(" · ")}
          {scan ? " — אומתו הבוקר" : ""}
        </AutoDir>
        <a
          href="#approvals"
          className="fv-ring mt-auto inline-flex items-center gap-1.5 self-start rounded-lg bg-[var(--surface)] px-3.5 py-1.5 pt-[7px] text-[13px] font-semibold text-[var(--accent)] transition-colors hover:bg-white"
        >
          לאישור ושליחה
          <ArrowLeft className="size-3.5" />
        </a>
      </div>
    );
  }

  if (scan) {
    /* שקט אמיתי — החלטה של המערכת, לא היעדר תוצאה. נייר עם פס ירוק, לא אפור. */
    return (
      <Card tone="accent" className="h-full">
        <CardBody className="flex h-full flex-col p-5">
          <span className="text-[13px] font-medium text-[var(--accent)]">היום שקט</span>
          <span className="mt-1 text-[17px] leading-snug font-semibold text-[var(--foreground)]">
            אין הודעה שראויה לזמן שלך
          </span>
          <span className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            נסרקו <Num>{he(scan.scanned)}</Num> כתבות · <Num>{he(scan.vetoed)}</Num> נפסלו כי לא היו
            מספיק אישיות
          </span>
          <Link
            href="/routine/radar"
            className="fv-ring mt-auto inline-flex items-center gap-1 self-start pt-2 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--accent)]"
          >
            מה נפסל היום ›
          </Link>
        </CardBody>
      </Card>
    );
  }

  /* עוד לא רצה סריקה — מצב הכנה, לא תקלה ולא שקט */
  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-dashed border-[var(--faint)] p-5">
      <span className="text-[13px] font-medium text-[var(--muted)]">ממתינות למשלוח</span>
      <span className="mt-1 text-[17px] leading-snug font-semibold text-[var(--foreground)]">
        עוד לא רצה סריקה
      </span>
      <span className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--faint)]">
        אחרי הסריקה הבאה, מה שיעבור את השערים יופיע כאן.
      </span>
    </div>
  );
}

/* ── KPI ────────────────────────────────────────────────────────────── */

function Kpi({
  icon: Icon,
  label,
  value,
  zero,
  chip,
  children,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  /** מה נכתב במקום הספרה כשאין כלום. הספרה 0 לא מוצגת לעולם. */
  zero: string;
  chip?: { text: string; fresh: boolean };
  children: React.ReactNode;
}) {
  const empty = value === 0;
  return (
    <Card className="h-full">
      <CardBody className="flex h-full flex-col gap-1 p-5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--muted)]">
          <Icon className="size-3.5 text-[var(--faint)]" />
          {label}
        </span>
        {empty ? (
          <span className="mt-1 text-[17px] leading-snug font-semibold text-[var(--foreground)]">
            {zero}
          </span>
        ) : (
          <span className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="type-num text-[34px] font-semibold leading-none">{he(value)}</span>
            {chip && <Chip tone={chip.fresh ? "accent" : "neutral"}>{chip.text}</Chip>}
          </span>
        )}
        <span className="mt-auto pt-1.5 text-[12.5px] text-[var(--faint)]">{children}</span>
      </CardBody>
    </Card>
  );
}

/* ── פיד ────────────────────────────────────────────────────────────── */

function Feed({ items, totalThisWeek }: { items: OverviewFeedItem[]; totalThisWeek: number }) {
  return (
    <Card className={`flex flex-col ${items.length > 0 ? "min-h-[380px]" : ""}`}>
      <CardBody className="flex min-h-0 flex-1 flex-col p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="type-h2">מה קרה ברשת שלך</h2>
          {items.length > 0 && (
            <span className="text-xs text-[var(--faint)]">
              <Num>{he(totalThisWeek)}</Num> עדכונים השבוע
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col gap-2 pt-5 pb-1">
            <p className="text-[17px] font-semibold text-[var(--foreground)]">שקט ברשת השבוע</p>
            <p className="max-w-[46ch] text-sm text-[var(--muted)]">
              לא נמצאו גיוסים, מינויים או כתבות שנוגעים לאנשים שבמעקב. זו תוצאה של הסריקה, לא תקלה
              בה.
            </p>
            <p className="max-w-[46ch] text-sm text-[var(--faint)]">
              הסריקה הבאה תרוץ מחר בבוקר ותבדוק שוב.
            </p>
          </div>
        ) : (
          <>
            <ul className="mt-3 flex-1 divide-y divide-[var(--line)] overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="grid grid-cols-[16px_1fr_auto] items-baseline gap-3 py-3"
                >
                  <span className="translate-y-0.5 text-[var(--faint)]" aria-hidden>
                    {item.kind === "company" ? (
                      <Building2 className="size-3.5" />
                    ) : (
                      <UserRound className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <AutoDir as="span" className="text-[14px] font-semibold">
                      {item.title}
                    </AutoDir>
                    {item.isNew && (
                      <Chip tone="accent" className="ms-2 px-2 py-0 align-[2px] text-[10px]">
                        חדש
                      </Chip>
                    )}
                    <AutoDir as="div" className="mt-0.5 text-[12.5px] text-[var(--muted)]">
                      {item.source}
                    </AutoDir>
                  </span>
                  <span className="text-[11.5px] whitespace-nowrap text-[var(--faint)]">
                    {formatRelative(item.at)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-[var(--line)] pt-3 text-[13px]">
              <Link href="/routine/radar" className="fv-ring text-[var(--accent)] hover:underline">
                לכל העדכונים של השבוע ←
              </Link>
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ── יצרת קשר ───────────────────────────────────────────────────────── */

const PERIODS = [
  { key: "today", label: "היום" },
  { key: "month", label: "החודש" },
  { key: "prevMonth", label: "חודש שעבר" },
  { key: "ytd", label: "מתחילת השנה" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

const WEEK_LABELS = ["ש1", "ש2", "ש3", "ש4", "ש5", "ש6", "ש7", "עכשיו"];

function Outreach({
  outreach,
  weekly,
}: {
  outreach: TodayOverviewProps["outreach"];
  weekly: number[];
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const value = outreach[period];
  const max = Math.max(...weekly, 1);

  const unit: Record<PeriodKey, string> = {
    today: "אנשים היום",
    month: "אנשים",
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
    <Card className="h-full">
      <CardBody className="flex h-full flex-col p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="type-h2">יצרת קשר</h2>
            <p className="mt-0.5 text-xs text-[var(--faint)]">הודעות שנשלחו בפועל</p>
          </div>
          <div
            role="group"
            aria-label="טווח זמן"
            className="inline-flex shrink-0 gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--neutral-soft)] p-0.5"
          >
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={
                  period === p.key
                    ? "fv-ring rounded-md bg-[var(--surface)] px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-[var(--foreground)] shadow-[var(--shadow-paper)]"
                    : "fv-ring rounded-md px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {value === 0 ? (
          <p className="mt-4 max-w-[40ch] text-sm text-[var(--muted)]">
            {period === "today" ? "עוד לא יצרת קשר עם אף אחד היום." : "לא נשלחו הודעות בתקופה הזו."}
          </p>
        ) : (
          <>
            <div className="mt-4 flex items-baseline gap-2.5">
              <span className="type-num text-[40px] leading-none font-semibold">{he(value)}</span>
              <span className="text-[13px] text-[var(--muted)]">{unit[period]}</span>
            </div>
            {delta && <p className="mt-1 text-xs font-medium text-[var(--muted)]">{delta}</p>}
          </>
        )}

        {/* קצב שבועי — 8 השבועות האחרונים; השבוע הנוכחי מודגש */}
        {weekly.some((w) => w > 0) && (
          <div className="mt-auto pt-5" aria-hidden>
            <div className="flex h-16 items-end gap-1.5">
              {weekly.map((w, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t-[3px] ${
                    w === 0
                      ? "bg-[var(--line)]" /* שבוע בלי קשר נראה ריק — קו, לא עמודה */
                      : i === weekly.length - 1
                        ? "bg-[var(--accent)]"
                        : "bg-[var(--accent-soft)]"
                  }`}
                  style={{ height: w === 0 ? "2px" : `${Math.max(8, Math.round((w / max) * 100))}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {WEEK_LABELS.map((l) => (
                <span key={l} className="type-num flex-1 text-center text-[10px] text-[var(--faint)]">
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── פוסט לינקדאין (בפיתוח) ─────────────────────────────────────────── */

function PostCard({ quietDay }: { quietDay: boolean }) {
  return (
    <Card className="border-dashed">
      <CardBody className="p-6">
        <Chip tone="warning" className="text-[10.5px]">
          בקרוב
        </Chip>
        <h2 className="type-h2 mt-2.5">
          {quietDay ? "יום שקט — זמן טוב לפוסט" : "פוסט חדש — לינקדאין"}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
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

/* ── המסך ───────────────────────────────────────────────────────────── */

export function TodayOverview({
  action,
  contacts,
  companyUpdates,
  peopleUpdates,
  outreach,
  weekly,
  feed,
  feedTotalThisWeek,
  latestImport,
}: TodayOverviewProps) {
  return (
    <div className="@container">
      {/* שורת הפתיחה: אריח הפעולה ראשון, ואז שלושת מספרי ההקשר */}
      <div className="grid items-stretch gap-4 @xl:grid-cols-2 @4xl:grid-cols-4">
        <ActionTile action={action} />

        <Kpi
          icon={Users}
          label="אנשי קשר במעקב"
          value={contacts.total}
          zero="עוד לא הוספת אנשי קשר"
          chip={
            contacts.addedThisMonth > 0
              ? {
                  text:
                    contacts.addedThisMonth === 1
                      ? "אחד נוסף החודש"
                      : `${he(contacts.addedThisMonth)} נוספו החודש`,
                  fresh: true,
                }
              : undefined
          }
        >
          <Link
            href={contacts.onRadar > 0 ? "/routine/radar" : "/contacts"}
            className="fv-ring group inline-flex items-center gap-1 hover:text-[var(--accent)]"
          >
            <Radar className="size-3" />
            {contacts.onRadar > 0 ? (
              <>
                <Num>{he(contacts.onRadar)}</Num> בראדאר הפעיל
              </>
            ) : (
              <>עוד אף אחד לא בראדאר — לבחור את הראשונים</>
            )}
            <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </Kpi>

        <Kpi
          icon={Building2}
          label="עדכוני חברות"
          value={companyUpdates.total}
          zero="שקט אצל החברות"
          chip={
            companyUpdates.fresh > 0
              ? { text: `${he(companyUpdates.fresh)} חדשים`, fresh: true }
              : { text: "אין חדשים היום", fresh: false }
          }
        >
          גיוסים, מוצרים, מהלכי חברה — 30 הימים האחרונים
        </Kpi>

        <Kpi
          icon={UserRound}
          label="עדכוני אנשים"
          value={peopleUpdates.total}
          zero="אף אחד לא החליף תפקיד"
          chip={
            peopleUpdates.fresh > 0
              ? { text: `${he(peopleUpdates.fresh)} חדשים`, fresh: true }
              : { text: "אין חדשים היום", fresh: false }
          }
        >
          תפקידים חדשים ומעברי חברה — 30 הימים האחרונים
        </Kpi>
      </div>

      {/* הגוף: פיד רחב + עמודת "יצרת קשר" והפוסט */}
      <div className="mt-4 grid items-stretch gap-4 @3xl:grid-cols-[1.6fr_1fr]">
        <Feed items={feed} totalThisWeek={feedTotalThisWeek} />
        <div className="grid content-start gap-4">
          <Outreach outreach={outreach} weekly={weekly} />
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
              ייבוא אחרון {formatRelative(latestImport.createdAt)} · נוספו{" "}
              <Num>{he(latestImport.added)}</Num>
            </>
          ) : (
            <>עוד לא ייבאת אנשי קשר — להתחיל כאן</>
          )}
          <ArrowLeft className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      </footer>
    </div>
  );
}
