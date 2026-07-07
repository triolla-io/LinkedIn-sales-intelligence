"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Play, Pause, Loader2, Search } from "lucide-react";
import { IndustrySelect } from "@/components/dashboard/industry-select";
import { SendWindowPicker, type SendWindow } from "@/components/prospecting/send-window-picker";
import { DEFAULT_SEND_DAYS, DEFAULT_SEND_HOURS_START, DEFAULT_SEND_HOURS_END } from "@/lib/prospecting/send-window";

type ProspectingRun = {
  id: string;
  name: string;
  status: string;
  totalDiscovered: number;
  totalSent: number;
  dailyCap: number;
  weeklyCap: number;
};

type RunsResponse = { runs: ProspectingRun[] };

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  RUNNING: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
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
};

export default function ProspectingPage() {
  const { data, mutate } = useSWR<RunsResponse>("/api/prospecting/runs", fetcher);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [geoCode, setGeoCode] = useState("IL");
  const [dailyCap, setDailyCap] = useState(15);
  const [industryIds, setIndustryIds] = useState<string[]>([]);
  const [sendWindow, setSendWindow] = useState<SendWindow>(DEFAULT_WINDOW);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

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

  async function startRun(id: string) {
    setActionId(id);
    await fetch(`/api/prospecting/runs/${id}/start`, { method: "POST" });
    setActionId(null);
    mutate();
  }

  async function pauseRun(id: string) {
    setActionId(id);
    await fetch(`/api/prospecting/runs/${id}/pause`, { method: "POST" });
    setActionId(null);
    mutate();
  }

  const runs = data?.runs ?? [];

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Search className="size-4 text-[#9b9895]" />
          <h1 className="text-sm font-semibold text-[#111110]">רוטין</h1>
          {data && (
            <span className="text-xs font-mono text-[#9b9895]">{runs.length} ריצות</span>
          )}
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 space-y-6">
        {/* New Run Form */}
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#111110] mb-4 text-right">רוטין חדש</h2>
          <form onSubmit={createRun} className="space-y-3" dir="rtl">
            <div className="flex gap-4 items-start">
              <div className="w-56 shrink-0">
                <label htmlFor="run-name" className="block text-xs font-medium text-[#6b6866] mb-1">
                  שם הריצה
                </label>
                <input
                  id="run-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="לדוגמה: מנכ״לים ישראל Q3"
                  dir="rtl"
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
                />
              </div>
              <div className="flex-1 pt-0.5">
                <SendWindowPicker compact value={sendWindow} onChange={setSendWindow} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="run-keywords" className="block text-xs font-medium text-[#6b6866] mb-1">
                  מילות חיפוש
                </label>
                <input
                  id="run-keywords"
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="cto, vp r&d, ceo"
                  dir="ltr"
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label htmlFor="run-geo" className="block text-xs font-medium text-[#6b6866] mb-1">
                  מדינה
                </label>
                <select
                  id="run-geo"
                  value={geoCode}
                  onChange={(e) => setGeoCode(e.target.value)}
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
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
                <label htmlFor="run-daily" className="block text-xs font-medium text-[#6b6866] mb-1">
                  הצעות חברות ביום
                </label>
                <input
                  id="run-daily"
                  type="number"
                  min={1}
                  max={20}
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
                />
              </div>
            </div>
            <IndustrySelect value={industryIds} onChange={setIndustryIds} />
            <p className="text-xs text-[#9b9895]">
              {dailyCap} בקשות/יום (מומלץ 15–20), עד 100/שבוע. חיבורים מדרגה 2 בלבד.
            </p>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0a70e0] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="size-3.5 animate-spin" />}
                יצירת ריצה
              </button>
            </div>
          </form>
        </div>

        {/* Runs List */}
        {!data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-[#9b9895]" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[#9b9895]">No prospecting runs yet. Create one above.</p>
          </div>
        ) : (
          <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e3df] bg-[#fafaf9]">
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">שם</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">סטטוס</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">נמצאו / נשלחו</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">מכסה (יום / שבוע)</th>
                  <th className="px-4 py-2.5" aria-label="פעולות" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e3df]">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-[#fafaf9] transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/prospecting/${run.id}`}
                        className="font-medium text-[#111110] hover:text-[#1585ff] transition-colors"
                      >
                        {run.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_COLORS[run.status] ?? "bg-[#f3f2ef] text-[#6b6866]"
                        }`}
                      >
                        {STATUS_LABELS[run.status] ?? run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#6b6866]">
                      {run.totalSent} / {run.totalDiscovered}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#6b6866]">
                      {run.dailyCap} / {run.weeklyCap}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(run.status === "DRAFT" || run.status === "PAUSED") && (
                        <button
                          type="button"
                          onClick={() => startRun(run.id)}
                          disabled={actionId === run.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#1585ff] border border-[#1585ff]/30 hover:bg-[#1585ff]/5 hover:border-[#1585ff]/50 rounded-md transition-all disabled:opacity-50"
                        >
                          {actionId === run.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Play className="size-3" />
                          )}
                          Start
                        </button>
                      )}
                      {run.status === "RUNNING" && (
                        <button
                          type="button"
                          onClick={() => pauseRun(run.id)}
                          disabled={actionId === run.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#dc2626] border border-[#dc2626]/30 hover:bg-[#dc2626]/5 hover:border-[#dc2626]/50 rounded-md transition-all disabled:opacity-50"
                        >
                          {actionId === run.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Pause className="size-3" />
                          )}
                          Pause
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
