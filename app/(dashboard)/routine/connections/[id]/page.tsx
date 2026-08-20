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
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  RUNNING: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
};

const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  DISCOVERED: { label: "ממתין בתור", cls: "bg-[#f3f2ef] text-[#6b6866]" },
  QUEUED: { label: "בתזמון", cls: "bg-[#fff8e6] text-[#b45309]" },
  SENT: { label: "נשלח", cls: "bg-[#e6faf0] text-[#059669]" },
  FAILED: { label: "נכשל", cls: "bg-[#fff3f3] text-[#dc2626]" },
  SKIPPED: { label: "דולג", cls: "bg-[#f3f2ef] text-[#9b9895]" },
  ACCEPTED: { label: "התקבל", cls: "bg-[#e6f4ff] text-[#1585ff]" },
};

const STATUS_CHIPS: { key: keyof StatusCounts; status: string; label: string; cls: string }[] = [
  { key: "sent", status: "SENT", label: "נשלחו", cls: "bg-[#e6faf0] text-[#059669]" },
  { key: "discovered", status: "DISCOVERED", label: "בתור", cls: "bg-[#f3f2ef] text-[#6b6866]" },
  { key: "queued", status: "QUEUED", label: "בתזמון", cls: "bg-[#fff8e6] text-[#b45309]" },
  { key: "failed", status: "FAILED", label: "נכשלו", cls: "bg-[#fff3f3] text-[#dc2626]" },
  { key: "skipped", status: "SKIPPED", label: "דולגו", cls: "bg-[#f3f2ef] text-[#9b9895]" },
];

const SUMMARY_CLS: Record<string, string> = {
  extension_offline: "bg-[#fff3f3] text-[#dc2626] border-[#f5c2c2]",
  frozen: "bg-[#fff3f3] text-[#dc2626] border-[#f5c2c2]",
  weekly_cap: "bg-[#fff8e6] text-[#b45309] border-[#f5e0a8]",
  daily_cap: "bg-[#fff8e6] text-[#b45309] border-[#f5e0a8]",
  completed: "bg-[#e6faf0] text-[#059669] border-[#a8e6c2]",
  waiting: "bg-[#eff5ff] text-[#1585ff] border-[#bcd9ff]",
  waiting_discovery: "bg-[#eff5ff] text-[#1585ff] border-[#bcd9ff]",
  paused: "bg-[#f3f2ef] text-[#6b6866] border-[#e5e3df]",
  idle: "bg-[#fafaf9] text-[#9b9895] border-[#e5e3df]",
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
            <a href={url} target="_blank" rel="noreferrer" className="text-[#1585ff] hover:underline">
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
    <div className="bg-white border border-[#e5e3df] rounded-xl p-4 space-y-3">
      <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">קהל יעד — למי שולחים</h2>
      <div className="space-y-2.5 text-sm text-[#6b6866]">
        <div className="flex items-start gap-2">
          <Users className="size-3.5 text-[#9b9895] mt-0.5 shrink-0" />
          <div className="flex flex-wrap gap-1">
            {titles.length > 0 ? (
              titles.map((t) => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#f3f2ef] text-xs text-[#111110]">
                  {t}
                </span>
              ))
            ) : (
              <span className="text-[#c8c5c2]">—</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="size-3.5 text-[#9b9895] shrink-0" />
          <span>
            {GEO_LABELS_HE[run.geoUrn] ?? "🌍 כל העולם"}
            {" · "}
            {isCompanyRun
              ? `${companyCount} חברות ברשימה (דרגה 2 + 3)`
              : "חיבורים מדרגה 2 בלבד"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Gauge className="size-3.5 text-[#9b9895] shrink-0" />
          <span>
            עד <b className="text-[#111110]">{pacing?.effectiveDailyCap ?? run.dailyCap}</b> בקשות ביום · עד{" "}
            <b className="text-[#111110]">{pacing?.effectiveWeeklyCap ?? run.weeklyCap}</b> בשבוע
            {pacing?.warmupWeek != null && (
              <span className="text-[#9b9895]">
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
    <div className="bg-white border border-[#e5e3df] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">חלון שליחה</h2>
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
            className="text-[#9b9895] hover:text-[#1585ff] transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      {!draft ? (
        <div className="flex items-center gap-2 text-sm text-[#6b6866]">
          <Clock className="size-3.5 text-[#9b9895]" />
          {formatSendWindowHe(run.sendDays, run.sendHoursStart, run.sendHoursEnd, run.sendMinutesStart ?? 0, run.sendMinutesEnd ?? 0)}
        </div>
      ) : (
        <div className="space-y-3">
          <SendWindowPicker value={draft} onChange={setDraft} />
          {error && <p className="text-xs text-[#dc2626]">השמירה נכשלה — נסו שוב.</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0a70e0] rounded-md transition-colors disabled:opacity-50"
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
              className="px-3 py-1.5 text-xs font-medium text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#c8c5c2] rounded-md transition-all"
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
        <Loader2 className="size-5 animate-spin text-[#9b9895]" />
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
    <div dir="rtl" className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      {/* Header */}
      <div className="relative flex items-center px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <Link href="/routine/connections" className="text-[#9b9895] hover:text-[#6b6866] transition-colors absolute right-5">
          <ArrowRight className="size-4" />
        </Link>
        <div className="flex items-center gap-3 mr-8">
          <h1 className="text-sm font-semibold text-[#111110]">{run.name}</h1>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              STATUS_COLORS[run.status] ?? "bg-[#f3f2ef] text-[#6b6866]"
            }`}
          >
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
          <span className="text-xs text-[#9b9895]">
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
            className="bg-[#fff8e6] border border-[#f0dfae] text-[#b45309] rounded-xl px-4 py-3 text-sm animate-in fade-in duration-300"
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
          <div className="bg-white border border-[#e5e3df] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">פעילות התוסף</h2>
              {taskStats.lastActivity && (
                <span className="text-xs text-[#9b9895]">
                  נראה לאחרונה: {new Date(taskStats.lastActivity).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* Search tasks */}
              <div className="bg-[#fafaf9] border border-[#e5e3df] rounded-lg p-3">
                <p className="text-xs font-medium text-[#6b6866] mb-2">חיפוש (איתור אנשים)</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-[#9b9895]">ממתינים: {taskStats.search.pending}</span>
                  <span className="text-[#059669]">הצליחו: {taskStats.search.done}</span>
                  <span className="text-[#dc2626]">נכשלו: {taskStats.search.failed}</span>
                  {taskStats.search.retried > 0 && (
                    <span className="text-[#9b9895]">ניסיונות חוזרים: {taskStats.search.retried}</span>
                  )}
                </div>
              </div>
              {/* Connect tasks */}
              <div className="bg-[#fafaf9] border border-[#e5e3df] rounded-lg p-3">
                <p className="text-xs font-medium text-[#6b6866] mb-2">הצעות חברות</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-[#9b9895]">ממתינות: {taskStats.connect.pending}</span>
                  <span className="text-[#059669]">נשלחו: {taskStats.connect.done}</span>
                  <span className="text-[#dc2626]">נכשלו: {taskStats.connect.failed}</span>
                  {taskStats.connect.skipped > 0 && (
                    <span className="text-[#9b9895]">דולגו (עוקב בלבד): {taskStats.connect.skipped}</span>
                  )}
                </div>
              </div>
            </div>
            {/* Recent failures */}
            {taskStats.recentFailures.length > 0 && (
              <div className="border-t border-[#e5e3df] pt-3">
                <p className="text-xs font-semibold text-[#dc2626] mb-2">כשלים אחרונים</p>
                <div className="space-y-1">
                  {taskStats.recentFailures.map((f) => {
                    const profileUrl = f.errorMessage?.match(/url=(https?:\/\/\S+?)\/?\)?\s*$/)?.[1];
                    const known = f.errorCode ? ERROR_CODE_LABELS[f.errorCode] : undefined;
                    const detail = humanizeErrorDetail(f.errorMessage);
                    const hint = f.errorCode ? ERROR_CODE_HINTS[f.errorCode] : undefined;
                    return (
                      <div key={`${f.kind}-${f.at}`} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[#9b9895]">{TASK_KIND_LABELS[f.kind] ?? f.kind}</span>
                          <span className="text-[#dc2626] bg-[#fff3f3] px-1.5 py-0.5 rounded">{known ?? f.errorCode}</span>
                          {detail && <span className="text-[#6b6866]">{detail}</span>}
                          {profileUrl && (
                            <a href={profileUrl} target="_blank" rel="noreferrer" className="text-[#1585ff] hover:underline">
                              לפרופיל
                            </a>
                          )}
                          {!known && !detail && f.errorMessage && (
                            <span className="text-[#6b6866] truncate max-w-xs" title={f.errorMessage}>{f.errorMessage}</span>
                          )}
                          <span className="text-[#9b9895] ms-auto">{new Date(f.at).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem" })}</span>
                        </div>
                        {hint && <p className="text-[#9b9895] pr-1">{hint}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#e5e3df] bg-[#fafaf9]">
            <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">
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
                        ? "ring-2 ring-[#1585ff] ring-offset-1"
                        : "hover:ring-1 hover:ring-[#c8c5c2]"
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
                className="text-xs text-[#1585ff] hover:underline cursor-pointer"
              >
                הצג הכל
              </button>
            )}
          </div>

          {filteredRequests.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#9b9895]">
                {statusFilter
                  ? `אין אנשים בסטטוס "${STATUS_CHIPS.find((c) => c.status === statusFilter)?.label ?? statusFilter}" בריצה זו.`
                  : "עדיין לא נמצאו אנשים בריצה זו."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e3df]">
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">שם</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">סטטוס</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">תפקיד</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">חברה</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">מיקום</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">עודכן</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e3df]">
                {filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-[#fafaf9] transition-colors">
                    <td className="px-4 py-3 font-medium text-[#111110]">
                      {req.linkedinUrl ? (
                        <a
                          href={req.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-[#1585ff] transition-colors"
                        >
                          {req.fullName}
                        </a>
                      ) : (
                        req.fullName
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${REQ_STATUS[req.status]?.cls ?? "bg-[#f3f2ef] text-[#6b6866]"}`}>
                        {REQ_STATUS[req.status]?.label ?? req.status}
                      </span>
                      {req.status === "SKIPPED" && req.skipReason && <span className="text-[10px] text-[#9b9895] block mt-0.5">{ERROR_CODE_LABELS[req.skipReason] ?? req.skipReason}</span>}
                      {req.status === "FAILED" && req.errorCode && (
                        <span
                          className="text-[10px] text-[#dc2626] block mt-0.5 max-w-55"
                          title={[humanizeErrorDetail(req.errorMessage), ERROR_CODE_HINTS[req.errorCode], req.errorMessage]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          {ERROR_CODE_LABELS[req.errorCode] ?? req.errorCode}
                          {ERROR_CODE_HINTS[req.errorCode] && (
                            <span className="text-[#9b9895] block">{ERROR_CODE_HINTS[req.errorCode]}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#6b6866]">
                      {req.currentTitle ?? <span className="text-[#c8c5c2]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#6b6866]">
                      {req.currentCompany ?? <span className="text-[#c8c5c2]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#6b6866]">
                      {req.location ?? <span className="text-[#c8c5c2]">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#9b9895]">
                      {new Date(req.sentAt ?? req.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {events && events.length > 0 && (
          <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e5e3df] bg-[#fafaf9]">
              <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">יומן פעילות</h2>
            </div>
            <ul className="divide-y divide-[#f3f2ef]">
              {events.map((e) => (
                <li key={`${e.type}-${e.createdAt}-${e.connectionRequestId ?? ""}-${e.message ?? ""}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <span className="font-mono text-[#6b6866] w-32 shrink-0 truncate">{EVENT_LABELS[e.type] ?? e.type}</span>
                  <span className="text-[#6b6866] truncate flex-1"><HumanMessage message={e.message} /></span>
                  <span className="text-[#9b9895] shrink-0">{new Date(e.createdAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
