"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Play, Pause, Loader2, Search, Building2 } from "lucide-react";
import { Switch, Tabs } from "@heroui/react";
import { IndustrySelect } from "@/components/dashboard/industry-select";
import { SendWindowPicker, type SendWindow } from "@/components/prospecting/send-window-picker";
import { CompaniesInput } from "@/components/prospecting/companies-input";
import { parseCompanyLines } from "@/lib/prospecting/company-lines";
import {
  DEFAULT_SEND_DAYS,
  DEFAULT_SEND_HOURS_START,
  DEFAULT_SEND_HOURS_END,
  DEFAULT_SEND_MINUTES_START,
  DEFAULT_SEND_MINUTES_END,
} from "@/lib/prospecting/send-window";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { fetcher } from "@/lib/fetcher";

type ProspectingRun = {
  id: string;
  name: string;
  status: string;
  targetType?: "KEYWORDS" | "COMPANY";
  totalDiscovered: number;
  totalSent: number;
  dailyCap: number;
  weeklyCap: number;
};

type RunsResponse = { runs: ProspectingRun[]; sentToday: number };


const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[var(--surface-secondary)] text-[var(--muted)]",
  RUNNING: "bg-[var(--accent-soft)] text-[var(--accent)]",
  PAUSED: "bg-[var(--neutral-soft)] text-[var(--muted)]",
  COMPLETED: "bg-[var(--success-soft)] text-[var(--success)]",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "טיוטה",
  RUNNING: "פעיל",
  PAUSED: "מושהה",
  COMPLETED: "הושלם",
};

const DEFAULT_WINDOW: SendWindow = {
  sendDays: DEFAULT_SEND_DAYS,
  sendHoursStart: DEFAULT_SEND_HOURS_START,
  sendHoursEnd: DEFAULT_SEND_HOURS_END,
  sendMinutesStart: DEFAULT_SEND_MINUTES_START,
  sendMinutesEnd: DEFAULT_SEND_MINUTES_END,
};

const C_LEVEL_PRESET = 'CEO, CTO, CFO, COO, CMO, Founder, Owner, מנכ"ל, סמנכ"ל';

export default function ProspectingPage() {
  const { data, mutate } = useSWR<RunsResponse>("/api/prospecting/runs", fetcher);
  const { modules, setModule } = useRoutineModules();
  const connectionsOn = modules?.connectionsEnabled ?? true;
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [geoCode, setGeoCode] = useState("IL");
  const [dailyCap, setDailyCap] = useState(15);
  const [industryIds, setIndustryIds] = useState<string[]>([]);
  const [sendWindow, setSendWindow] = useState<SendWindow>(DEFAULT_WINDOW);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [tab, setTab] = useState<"keywords" | "companies">("keywords");
  const [titles, setTitles] = useState(C_LEVEL_PRESET);
  const [companiesText, setCompaniesText] = useState("");
  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [companyGeo, setCompanyGeo] = useState("WORLD");

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await fetch("/api/prospecting/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), keywords: keywords.trim(), geoCode, industryIds, dailyCap, ...sendWindow }),
    });
    setName("");
    setKeywords("");
    setGeoCode("IL");
    setDailyCap(15);
    setIndustryIds([]);
    setSendWindow(DEFAULT_WINDOW);
    setSubmitting(false);
    mutate();
  }

  async function createCompanyRun(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !titles.trim()) return;
    const companies = parseCompanyLines(companiesText);
    if (companies.length === 0 && !companyFile) {
      toast.error(
        "נדרשת לפחות חברה אחת",
        "הזן חברות בטקסט או העלה קובץ מהגיליון",
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/prospecting/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "COMPANY",
          name: name.trim(),
          keywords: titles.trim(),
          geoCode: companyGeo,
          dailyCap,
          companies,
          ...sendWindow,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.run) {
        toast.error(
          "יצירת הרוטינה נכשלה",
          typeof data.error === "string" ? data.error : undefined,
        );
        return;
      }
      let added = data.companies?.added ?? 0;
      let skipped =
        (data.companies?.skippedExisting ?? 0) +
        (data.companies?.skippedInvalid ?? 0);
      if (companyFile) {
        const form = new FormData();
        form.append("file", companyFile);
        const up = await fetch(`/api/prospecting/runs/${data.run.id}/companies`, {
          method: "POST",
          body: form,
        });
        const upData = await up.json().catch(() => ({}));
        if (up.ok) {
          added += upData.added ?? 0;
          skipped += (upData.skippedExisting ?? 0) + (upData.skippedInvalid ?? 0);
        } else {
          toast.error(
            "העלאת הקובץ נכשלה",
            typeof upData.error === "string" ? upData.error : undefined,
          );
        }
      }
      toast.success(
        `הרוטינה נוצרה — ${added} חברות נוספו`,
        skipped > 0 ? `${skipped} שורות דולגו (כפולות או לא תקינות)` : undefined,
      );
      setName("");
      setTitles(C_LEVEL_PRESET);
      setCompaniesText("");
      setCompanyFile(null);
      setCompanyGeo("WORLD");
      setDailyCap(15);
      setSendWindow(DEFAULT_WINDOW);
      mutate();
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(runId: string, action: "start" | "pause") {
    if (actionId) return; // one run action at a time
    // Updater form: react-doctor's no-impure-state-updater misreads a plain identifier arg here.
    setActionId(() => runId);
    try {
      await fetch(`/api/prospecting/runs/${runId}/${action}`, { method: "POST" });
    } finally {
      setActionId(null);
      mutate();
    }
  }

  const runs = data?.runs ?? [];

  return (
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Search className="size-4 text-[var(--faint)]" />
          <h1 className="text-sm font-semibold text-[var(--foreground)]">בקשות חברות</h1>
          {data && (
            <span className="text-xs tabular-nums text-[var(--faint)]">
              {runs.filter((r) => r.status === "RUNNING").length} ריצות פעילות · {data.sentToday ?? 0} נשלחו היום
            </span>
          )}
        </div>
        {modules && (
          <div className="flex items-center gap-2" dir="rtl">
            <span className={cn("text-xs font-medium", connectionsOn ? "text-[var(--success)]" : "text-[var(--warning)]")}>
              {connectionsOn ? "המודול פעיל" : "המודול כבוי"}
            </span>
            <Switch
              size="sm"
              isSelected={connectionsOn}
              onChange={(v: boolean) => setModule("connections", v)}
              aria-label="הפעלת מודול בקשות חברות"
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        )}
      </div>

      {!connectionsOn && (
        <div className="px-5 py-2.5 bg-[var(--warning-soft)] border-b border-[var(--warning-soft)] text-xs text-[var(--warning)]" dir="rtl">
          המודול כבוי — כל הריצות מושהות. לא יישלחו בקשות חברות עד שהמודול יופעל מחדש.
        </div>
      )}

      <div className="px-5 pt-5 pb-8 space-y-6">
        {/* New Run Form */}
        <div className="bg-surface border border-[var(--line)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4 text-right">רוטין חדש</h2>
          <Tabs
            selectedKey={tab}
            onSelectionChange={(k) => setTab(k as "keywords" | "companies")}
            className="w-full"
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="סוג רוטינה">
                <Tabs.Tab id="keywords">
                  לפי תפקידים
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="companies">
                  לפי חברות
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>

            <Tabs.Panel id="keywords" className="pt-4">
          <form onSubmit={createRun} className="space-y-3" dir="rtl">
            <div className="flex gap-4 items-start">
              <div className="w-56 shrink-0">
                <label htmlFor="run-name" className="block text-xs font-medium text-[var(--muted)] mb-1">
                  שם הריצה
                </label>
                <input
                  id="run-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="לדוגמה: מנכ״לים ישראל Q3"
                  dir="rtl"
                  className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                />
              </div>
              <div className="flex-1 pt-0.5">
                <SendWindowPicker compact value={sendWindow} onChange={setSendWindow} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="run-keywords" className="block text-xs font-medium text-[var(--muted)] mb-1">
                  מילות חיפוש
                </label>
                <input
                  id="run-keywords"
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="cto, vp r&d, ceo"
                  dir="ltr"
                  className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                />
              </div>
              <div>
                <label htmlFor="run-geo" className="block text-xs font-medium text-[var(--muted)] mb-1">
                  מדינה
                </label>
                <select
                  id="run-geo"
                  value={geoCode}
                  onChange={(e) => setGeoCode(e.target.value)}
                  className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                >
                  <option value="IL">🇮🇱 ישראל</option>
                  <option value="US">🇺🇸 ארה״ב</option>
                  <option value="GB">🇬🇧 בריטניה</option>
                  <option value="DE">🇩🇪 גרמניה</option>
                  <option value="FR">🇫🇷 צרפת</option>
                  <option value="CA">🇨🇦 קנדה</option>
                  <option value="AU">🇦🇺 אוסטרליה</option>
                  <option value="NL">🇳🇱 הולנד</option>
                  <option value="IN">🇮🇳 הודו</option>
                  <option value="SG">🇸🇬 סינגפור</option>
                </select>
              </div>
              <div>
                <label htmlFor="run-daily" className="block text-xs font-medium text-[var(--muted)] mb-1">
                  הצעות חברות ביום
                </label>
                <input
                  id="run-daily"
                  type="number"
                  min={1}
                  max={20}
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                />
              </div>
            </div>
            <IndustrySelect value={industryIds} onChange={setIndustryIds} />
            <p className="text-xs text-[var(--faint)]">
              {dailyCap} בקשות/יום (מומלץ 15–20), עד 100/שבוע. חיבורים מדרגה 2 בלבד.
            </p>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] rounded-md transition-[background-color,transform] active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                יצירת ריצה
              </button>
            </div>
          </form>
            </Tabs.Panel>

            <Tabs.Panel id="companies" className="pt-4">
              <form
                onSubmit={createCompanyRun}
                className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
                dir="rtl"
              >
                <div className="flex gap-4 items-start">
                  <div className="w-56 shrink-0">
                    <label htmlFor="company-run-name" className="block text-xs font-medium text-[var(--muted)] mb-1">
                      שם הרוטינה
                    </label>
                    <input
                      id="company-run-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="לדוגמה: C-Level — לקוחות Q3"
                      className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                    />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <SendWindowPicker compact value={sendWindow} onChange={setSendWindow} />
                  </div>
                </div>

                <div>
                  <label htmlFor="company-run-titles" className="block text-xs font-medium text-[var(--muted)] mb-1">
                    תפקידים לחיפוש <span className="text-[var(--faint)]">(מאותחל ל-C-Level, ניתן לעריכה)</span>
                  </label>
                  <input
                    id="company-run-titles"
                    dir="ltr"
                    value={titles}
                    onChange={(e) => setTitles(e.target.value)}
                    className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                  />
                </div>

                <CompaniesInput
                  value={companiesText}
                  onChange={setCompaniesText}
                  file={companyFile}
                  onFileChange={setCompanyFile}
                  disabled={submitting}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="company-run-geo" className="block text-xs font-medium text-[var(--muted)] mb-1">
                      אזור
                    </label>
                    <select
                      id="company-run-geo"
                      value={companyGeo}
                      onChange={(e) => setCompanyGeo(e.target.value)}
                      className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                    >
                      <option value="WORLD">🌍 כל העולם</option>
                      <option value="IL">🇮🇱 ישראל</option>
                      <option value="US">🇺🇸 ארה״ב</option>
                      <option value="GB">🇬🇧 בריטניה</option>
                      <option value="DE">🇩🇪 גרמניה</option>
                      <option value="FR">🇫🇷 צרפת</option>
                      <option value="CA">🇨🇦 קנדה</option>
                      <option value="AU">🇦🇺 אוסטרליה</option>
                      <option value="NL">🇳🇱 הולנד</option>
                      <option value="IN">🇮🇳 הודו</option>
                      <option value="SG">🇸🇬 סינגפור</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="company-run-daily" className="block text-xs font-medium text-[var(--muted)] mb-1">
                      בקשות ליום
                    </label>
                    <input
                      id="company-run-daily"
                      type="number"
                      min={1}
                      max={20}
                      value={dailyCap}
                      onChange={(e) => setDailyCap(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
                    />
                  </div>
                </div>

                <p className="text-xs text-[var(--faint)]">
                  המערכת תאתר את אנשי ה-C-Level בכל חברה (דרגה 2 + 3) ותשלח בקשות חברות לפי המכסה והחלון שהוגדרו.
                </p>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting || !name.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-strong)] rounded-md transition-[background-color,transform] active:scale-[0.96] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Building2 className="size-3.5" />}
                    צור רוטינת חברות
                  </button>
                </div>
              </form>
            </Tabs.Panel>
          </Tabs>
        </div>

        {/* Runs List */}
        {!data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-[var(--faint)]" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--faint)]">No prospecting runs yet. Create one above.</p>
          </div>
        ) : (
          <div className="bg-surface border border-[var(--line)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--surface-secondary)]">
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">שם</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">סטטוס</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">נמצאו / נשלחו</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">מכסה (יום / שבוע)</th>
                  <th className="px-4 py-2.5" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-[var(--surface-secondary)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/routine/connections/${run.id}`}
                          className="font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
                        >
                          {run.name}
                        </Link>
                        {run.targetType === "COMPANY" && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--surface-secondary)] text-[10px] text-[var(--muted)]">
                            <Building2 className="w-3 h-3" />
                            חברות
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          !connectionsOn && run.status === "RUNNING"
                            ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                            : STATUS_COLORS[run.status] ?? "bg-[var(--surface-secondary)] text-[var(--muted)]"
                        }`}
                      >
                        {!connectionsOn && run.status === "RUNNING"
                          ? "מושהה ע״י המודול"
                          : STATUS_LABELS[run.status] ?? run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {run.totalSent} / {run.totalDiscovered}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {run.dailyCap} / {run.weeklyCap}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(run.status === "DRAFT" || run.status === "PAUSED") && (
                        <button
                          type="button"
                          onClick={() => runAction(run.id, "start")}
                          disabled={actionId === run.id || !connectionsOn}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 hover:border-[var(--accent)]/50 rounded-md transition-all disabled:opacity-50"
                        >
                          {actionId === run.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Play className="size-3" />
                          )}
                          הפעל
                        </button>
                      )}
                      {run.status === "RUNNING" && (
                        <button
                          type="button"
                          onClick={() => runAction(run.id, "pause")}
                          disabled={actionId === run.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger)]/5 hover:border-[var(--danger)]/50 rounded-md transition-all disabled:opacity-50"
                        >
                          {actionId === run.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Pause className="size-3" />
                          )}
                          השהה
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
