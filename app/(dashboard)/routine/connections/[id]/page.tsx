"use client";

import { use, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowRight, Loader2, Clock, Pencil, Users, Globe, Gauge } from "lucide-react";
import { ERROR_CODE_LABELS, ERROR_CODE_HINTS, humanizeErrorDetail, TASK_KIND_LABELS } from "@/lib/prospecting/format";
import { SendWindowPicker, type SendWindow } from "@/components/prospecting/send-window-picker";
import { formatSendWindowHe } from "@/lib/prospecting/send-window";
import {
  CompanyTargetsCard,
  type CompanyTargetRow,
} from "@/components/prospecting/company-targets-card";
import { fetcher } from "@/lib/fetcher";

type ConnectionRequest = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  linkedinUrl: string | null;
  status: string;
  skipReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
};

type RunDetail = {
  name: string;
  status: string;
  targetType?: "KEYWORDS" | "COMPANY";
  keywords: string;
  geoUrn: string;
  dailyCap: number;
  weeklyCap: number;
  totalSent: number;
  totalDiscovered: number;
  sendDays: number[];
  sendMinutesStart: number;
  sendMinutesEnd: number;
  sendHoursStart: number;
  sendHoursEnd: number;
};

type TaskStats = {
  search: { pending: number; done: number; failed: number; retried: number };
  connect: { pending: number; done: number; failed: number; skipped: number };
  recentFailures: { kind: string; errorCode: string | null; errorMessage: string | null; at: string }[];
  lastActivity: string | null;
};

type ProspectingEventRow = { type: string; message: string | null; at?: string; createdAt: string; connectionRequestId: string | null };
type StatusCounts = { discovered: number; queued: number; sent: number; failed: number; skipped: number };
type Summary = { state: string; message: string; nextAt: string | null };

type Pacing = {
  effectiveDailyCap: number;
  effectiveWeeklyCap: number;
  dailyTarget: number;
  warmupWeek: number | null;
};

type RunDetailResponse = {
  run: RunDetail;
  requests: ConnectionRequest[];
  statusCounts: StatusCounts;
  events: ProspectingEventRow[];
  taskStats: TaskStats;
  summary: Summary;
  companyTargets?: CompanyTargetRow[];
  pacing?: Pacing;
};


const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[var(--surface-secondary)] text-[var(--muted)]",
  RUNNING: "bg-[var(--accent-soft)] text-[var(--accent)]",
  PAUSED: "bg-[var(--neutral-soft)] text-[var(--muted)]",
  COMPLETED: "bg-[var(--success-soft)] text-[var(--success)]",
};

const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  DISCOVERED: { label: "ממתין בתור", cls: "bg-[var(--surface-secondary)] text-[var(--muted)]" },
  QUEUED: { label: "בתזמון", cls: "bg-[var(--warning-soft)] text-[var(--warning)]" },
  SENT: { label: "נשלח", cls: "bg-[var(--success-soft)] text-[var(--success)]" },
  FAILED: { label: "נכשל", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
  SKIPPED: { label: "דולג", cls: "bg-[var(--surface-secondary)] text-[var(--faint)]" },
  ACCEPTED: { label: "התקבל", cls: "bg-[var(--accent-soft)] text-[var(--accent)]" },
};

const STATUS_CHIPS: { key: keyof StatusCounts; status: string; label: string; cls: string }[] = [
  { key: "sent", status: "SENT", label: "נשלחו", cls: "bg-[var(--success-soft)] text-[var(--success)]" },
  { key: "discovered", status: "DISCOVERED", label: "בתור", cls: "bg-[var(--surface-secondary)] text-[var(--muted)]" },
  { key: "queued", status: "QUEUED", label: "בתזמון", cls: "bg-[var(--warning-soft)] text-[var(--warning)]" },
  { key: "failed", status: "FAILED", label: "נכשלו", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
  { key: "skipped", status: "SKIPPED", label: "דולגו", cls: "bg-[var(--surface-secondary)] text-[var(--faint)]" },
];

const SUMMARY_CLS: Record<string, string> = {
  extension_offline: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger-soft)]",
  frozen: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger-soft)]",
  weekly_cap: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning-soft)]",
  daily_cap: "bg-[var(--warning-soft)] text-[var(--warning)] border-[var(--warning-soft)]",
  completed: "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success-soft)]",
  waiting: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-soft)]",
  waiting_discovery: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-soft)]",
  paused: "bg-[var(--surface-secondary)] text-[var(--muted)] border-[var(--line)]",
  idle: "bg-[var(--surface-secondary)] text-[var(--faint)] border-[var(--line)]",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "טיוטה",
  RUNNING: "פעיל",
  PAUSED: "מושהה",
  COMPLETED: "הושלם",
};

const EVENT_LABELS: Record<string, string> = {
  DISCOVERED: "נמצא",
  SKIPPED: "דולג",
  QUEUED: "נכנס לתור",
  SCHEDULED: "תוזמן",
  QUOTA_DEFERRED: "נדחה (מכסה)",
  SEND_ATTEMPT: "ניסיון שליחה",
  SENT: "נשלח",
  FAILED: "נכשל",
  ALREADY_PENDING: "כבר ממתין",
  ALREADY_CONNECTED: "כבר מחובר",
  CHECKPOINT: "החשבון מוקפא",
  COMPLETED: "הרוטינה הושלמה",
};

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const formatIso = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/** Renders raw event/error messages in user language: translates error codes, links profile URLs, localizes ISO timestamps. */
function HumanMessage({ message }: { message: string | null }) {
  if (!message) return null;
  const url = message.match(/url=(https?:\/\/\S+?)\/?\)\s*$/)?.[1];
  const code = message.match(/^([a-z_]+)\s*\(url=/)?.[1];
  const translated = code ? (ERROR_CODE_LABELS[code] ?? code) : humanizeErrorDetail(message);
  if (translated) {
    return (
      <>
        {translated}
        {url && (
          <>
            {" "}
            <a href={url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
              לפרופיל
            </a>
          </>
        )}
      </>
    );
  }
  return <>{message.replace(ISO_RE, formatIso)}</>;
}

/** geoUrn (as stored on the run) → Hebrew country label. Empty urn = worldwide. */
const GEO_LABELS_HE: Record<string, string> = {
  "": "🌍 כל העולם",
  "101620260": "🇮🇱 ישראל",
  "103644278": "🇺🇸 ארה״ב",
  "101165590": "🇬🇧 בריטניה",
  "101282230": "🇩🇪 גרמניה",
  "105015875": "🇫🇷 צרפת",
  "101174742": "🇨🇦 קנדה",
  "101452733": "🇦🇺 אוסטרליה",
  "102890719": "🇳🇱 הולנד",
  "102713980": "🇮🇳 הודו",
  "102454443": "🇸🇬 סינגפור",
};

/** "קהל יעד" card: who we send to — titles, region, degree, and the send quota. */
function TargetProfileCard({ run, companyCount, pacing }: { run: RunDetail; companyCount: number; pacing?: Pacing }) {
  const titles = run.keywords.split(",").map((t) => t.trim()).filter(Boolean);
  const isCompanyRun = run.targetType === "COMPANY";
  return (
    <div className="bg-surface border border-[var(--line)] rounded-xl p-4 space-y-3">
      <h2 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">קהל יעד — למי שולחים</h2>
      <div className="space-y-2.5 text-sm text-[var(--muted)]">
        <div className="flex items-start gap-2">
          <Users className="size-3.5 text-[var(--faint)] mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1">
            {titles.length > 0 ? (
              titles.map((t) => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--surface-secondary)] text-xs text-[var(--foreground)]">
                  {t}
                </span>
              ))
            ) : (
              <span className="text-[var(--faint)]">—</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="size-3.5 text-[var(--faint)] shrink-0" />
          <span>
            {GEO_LABELS_HE[run.geoUrn] ?? "🌍 כל העולם"}
            {" · "}
            {isCompanyRun
              ? `${companyCount} חברות ברשימה (דרגה 2 + 3)`
              : "חיבורים מדרגה 2 בלבד"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="size-3.5 text-[var(--faint)] shrink-0" />
          <span>
            עד <b className="text-[var(--foreground)]">{pacing?.effectiveDailyCap ?? run.dailyCap}</b> בקשות ביום · עד{" "}
            <b className="text-[var(--foreground)]">{pacing?.effectiveWeeklyCap ?? run.weeklyCap}</b> בשבוע
            {pacing?.warmupWeek != null && (
              <span className="text-[var(--faint)]">
                {" · "}החשבון בחימום — שבוע {pacing.warmupWeek} מתוך 4, היעד להיום: {pacing.dailyTarget} בקשות
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** "חלון שליחה" card: compact summary + pencil → inline picker with save/cancel. */
function SendWindowCard({ runId, run, onSaved }: { runId: string; run: RunDetail; onSaved: () => void }) {
  const [draft, setDraft] = useState<SendWindow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(false);
    try {
      const res = await fetch(`/api/prospecting/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(`patch_failed_${res.status}`);
      setDraft(null);
      onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-[var(--line)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">חלון שליחה</h2>
        {!draft && (
          <button
            type="button"
            aria-label="עריכת חלון שליחה"
            onClick={() =>
              setDraft({
                sendDays: run.sendDays,
                sendHoursStart: run.sendHoursStart,
                sendHoursEnd: run.sendHoursEnd,
                sendMinutesStart: run.sendMinutesStart ?? 0,
                sendMinutesEnd: run.sendMinutesEnd ?? 0,
              })
            }
            className="text-[var(--faint)] hover:text-[var(--accent)] transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      {!draft ? (
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Clock className="size-3.5 text-[var(--faint)]" />
          {formatSendWindowHe(run.sendDays, run.sendHoursStart, run.sendHoursEnd, run.sendMinutesStart ?? 0, run.sendMinutesEnd ?? 0)}
        </div>
      ) : (
        <div className="space-y-3">
          <SendWindowPicker value={draft} onChange={setDraft} />
          {error && <p className="text-xs text-[var(--danger)]">השמירה נכשלה — נסו שוב.</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] rounded-md transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3 animate-spin" />}
              שמירה
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(false);
              }}
              className="px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--line)] hover:border-[var(--faint)] rounded-md transition-all"
            >
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProspectingRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const { data, mutate } = useSWR<RunDetailResponse>(
    `/api/prospecting/runs/${id}${statusFilter ? `?status=${statusFilter}` : ""}`,
    fetcher,
    { refreshInterval: 15000, keepPreviousData: true }
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-[var(--faint)]" />
      </div>
    );
  }

  const { run, requests, taskStats, statusCounts, events, summary } = data;
  const filteredRequests = statusFilter
    ? requests.filter((r) => r.status === statusFilter)
    : requests;
  // Events arrive newest-first, so the first SENT event is the most recent send.
  const lastSentEvent = events?.find((e) => e.type === "SENT") ?? null;

  return (
    <div dir="rtl" className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="relative flex items-center px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
        <Link href="/routine/connections" className="text-[var(--faint)] hover:text-[var(--muted)] transition-colors absolute right-5">
          <ArrowRight className="size-4" />
        </Link>
        <div className="flex items-center gap-3 mr-8">
          <h1 className="text-sm font-semibold text-[var(--foreground)]">{run.name}</h1>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              STATUS_COLORS[run.status] ?? "bg-[var(--surface-secondary)] text-[var(--muted)]"
            }`}
          >
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
          <span className="text-xs text-[var(--faint)]">
            {run.totalSent} נשלחו · {run.totalDiscovered} נמצאו
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pt-5 pb-8 space-y-4">
        {/* Send update — status + last send, always first */}
        {summary && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${SUMMARY_CLS[summary.state] ?? SUMMARY_CLS.idle}`}>
            <p className="font-medium">{summary.message}</p>
            {lastSentEvent && (
              <p className="text-xs mt-1 opacity-80">
                שליחה אחרונה: {lastSentEvent.message ?? ""} ·{" "}
                {new Date(lastSentEvent.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}

        {/* Send settings — target audience + send window */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TargetProfileCard run={run} companyCount={data.companyTargets?.length ?? 0} pacing={data.pacing} />
          <SendWindowCard runId={id} run={run} onSaved={() => mutate()} />
        </div>

        {events?.some((e) => e.message === "extension_outdated") && (
          <div
            dir="rtl"
            className="bg-[var(--warning-soft)] border border-[var(--warning-soft)] text-[var(--warning)] rounded-xl px-4 py-3 text-sm animate-in fade-in duration-300"
          >
            גרסת התוסף שלך אינה תומכת בזיהוי חברות — עדכן את תוסף הכרום כדי
            שהרוטינה תמשיך לרוץ.
          </div>
        )}
        {run.targetType === "COMPANY" && (
          <CompanyTargetsCard
            runId={id}
            targets={data.companyTargets ?? []}
            onChanged={() => mutate()}
          />
        )}
        {/* Task status panel */}
        {taskStats && (
          <div className="bg-surface border border-[var(--line)] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">פעילות התוסף</h2>
              {taskStats.lastActivity && (
                <span className="text-xs text-[var(--faint)]">
                  נראה לאחרונה: {new Date(taskStats.lastActivity).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Search tasks */}
              <div className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-lg p-3">
                <p className="text-xs font-medium text-[var(--muted)] mb-2">חיפוש (איתור אנשים)</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-[var(--faint)]">ממתינים: {taskStats.search.pending}</span>
                  <span className="text-[var(--success)]">הצליחו: {taskStats.search.done}</span>
                  <span className="text-[var(--danger)]">נכשלו: {taskStats.search.failed}</span>
                  {taskStats.search.retried > 0 && (
                    <span className="text-[var(--faint)]">ניסיונות חוזרים: {taskStats.search.retried}</span>
                  )}
                </div>
              </div>
              {/* Connect tasks */}
              <div className="bg-[var(--surface-secondary)] border border-[var(--line)] rounded-lg p-3">
                <p className="text-xs font-medium text-[var(--muted)] mb-2">הצעות חברות</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-[var(--faint)]">ממתינות: {taskStats.connect.pending}</span>
                  <span className="text-[var(--success)]">נשלחו: {taskStats.connect.done}</span>
                  <span className="text-[var(--danger)]">נכשלו: {taskStats.connect.failed}</span>
                  {taskStats.connect.skipped > 0 && (
                    <span className="text-[var(--faint)]">דולגו (עוקב בלבד): {taskStats.connect.skipped}</span>
                  )}
                </div>
              </div>
            </div>
            {/* Recent failures */}
            {taskStats.recentFailures.length > 0 && (
              <div className="border-t border-[var(--line)] pt-3">
                <p className="text-xs font-semibold text-[var(--danger)] mb-2">כשלים אחרונים</p>
                <div className="space-y-1">
                  {taskStats.recentFailures.map((f) => {
                    const profileUrl = f.errorMessage?.match(/url=(https?:\/\/\S+?)\/?\)?\s*$/)?.[1];
                    const known = f.errorCode ? ERROR_CODE_LABELS[f.errorCode] : undefined;
                    const detail = humanizeErrorDetail(f.errorMessage);
                    const hint = f.errorCode ? ERROR_CODE_HINTS[f.errorCode] : undefined;
                    return (
                      <div key={`${f.kind}-${f.at}`} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--faint)]">{TASK_KIND_LABELS[f.kind] ?? f.kind}</span>
                          <span className="text-[var(--danger)] bg-[var(--danger-soft)] px-1.5 py-0.5 rounded">{known ?? f.errorCode}</span>
                          {detail && <span className="text-[var(--muted)]">{detail}</span>}
                          {profileUrl && (
                            <a href={profileUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                              לפרופיל
                            </a>
                          )}
                          {!known && !detail && f.errorMessage && (
                            <span className="text-[var(--muted)] truncate max-w-xs" title={f.errorMessage}>{f.errorMessage}</span>
                          )}
                          <span className="text-[var(--faint)] ms-auto">{new Date(f.at).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem" })}</span>
                        </div>
                        {hint && <p className="text-[var(--faint)] pr-1">{hint}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-surface border border-[var(--line)] rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-secondary)]">
            <h2 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">
              אנשים בריצה ({filteredRequests.length})
            </h2>
            {/* The chips filter THIS table — they live in its header so the effect is visible. */}
            {statusCounts && (
              <div className="flex flex-wrap gap-1.5 ms-2">
                {STATUS_CHIPS.map((chip) => (
                  <button
                    key={chip.status}
                    type="button"
                    onClick={() => setStatusFilter(statusFilter === chip.status ? null : chip.status)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-shadow cursor-pointer ${chip.cls} ${
                      statusFilter === chip.status
                        ? "ring-2 ring-[var(--accent)] ring-offset-1"
                        : "hover:ring-1 hover:ring-[var(--faint)]"
                    }`}
                  >
                    {chip.label} {statusCounts[chip.key]}
                  </button>
                ))}
              </div>
            )}
            {statusFilter && (
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
              >
                הצג הכל
              </button>
            )}
          </div>

          {filteredRequests.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[var(--faint)]">
                {statusFilter
                  ? `אין אנשים בסטטוס "${STATUS_CHIPS.find((c) => c.status === statusFilter)?.label ?? statusFilter}" בריצה זו.`
                  : "עדיין לא נמצאו אנשים בריצה זו."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">שם</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">סטטוס</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">תפקיד</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">חברה</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">מיקום</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">עודכן</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-[var(--surface-secondary)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                      {req.linkedinUrl ? (
                        <a
                          href={req.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-[var(--accent)] transition-colors"
                        >
                          {req.fullName}
                        </a>
                      ) : (
                        req.fullName
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${REQ_STATUS[req.status]?.cls ?? "bg-[var(--surface-secondary)] text-[var(--muted)]"}`}>
                        {REQ_STATUS[req.status]?.label ?? req.status}
                      </span>
                      {req.status === "SKIPPED" && req.skipReason && <span className="text-[10px] text-[var(--faint)] block mt-0.5">{ERROR_CODE_LABELS[req.skipReason] ?? req.skipReason}</span>}
                      {req.status === "FAILED" && req.errorCode && (
                        <span
                          className="text-[10px] text-[var(--danger)] block mt-0.5 max-w-55"
                          title={[humanizeErrorDetail(req.errorMessage), ERROR_CODE_HINTS[req.errorCode], req.errorMessage]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          {ERROR_CODE_LABELS[req.errorCode] ?? req.errorCode}
                          {ERROR_CODE_HINTS[req.errorCode] && (
                            <span className="text-[var(--faint)] block">{ERROR_CODE_HINTS[req.errorCode]}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {req.currentTitle ?? <span className="text-[var(--faint)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {req.currentCompany ?? <span className="text-[var(--faint)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {req.location ?? <span className="text-[var(--faint)]">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--faint)]">
                      {new Date(req.sentAt ?? req.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {events && events.length > 0 && (
          <div className="bg-surface border border-[var(--line)] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] bg-[var(--surface-secondary)]">
              <h2 className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">יומן פעילות</h2>
            </div>
            <ul className="divide-y divide-[var(--surface-secondary)]">
              {events.map((e) => (
                <li key={`${e.type}-${e.createdAt}-${e.connectionRequestId ?? ""}-${e.message ?? ""}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-[var(--muted)] w-32 shrink-0 truncate">{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="text-[var(--muted)] truncate flex-1"><HumanMessage message={e.message} /></span>
                  <span className="text-[var(--faint)] shrink-0">{new Date(e.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
