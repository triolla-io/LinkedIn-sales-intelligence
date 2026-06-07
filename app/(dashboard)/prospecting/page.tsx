"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Play, Pause, Loader2, Search } from "lucide-react";

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

export default function ProspectingPage() {
  const { data, mutate } = useSWR<RunsResponse>("/api/prospecting/runs", fetcher);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [geoCode, setGeoCode] = useState("IL");
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    await fetch("/api/prospecting/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), keywords: keywords.trim(), geoCode }),
    });
    setName("");
    setKeywords("");
    setGeoCode("IL");
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
          <h1 className="text-sm font-semibold text-[#111110]">Prospecting</h1>
          {data && (
            <span className="text-xs font-mono text-[#9b9895]">{runs.length} runs</span>
          )}
        </div>
      </div>

      <div className="px-5 pt-5 pb-8 space-y-6">
        {/* New Run Form */}
        <div className="bg-white border border-[#e5e3df] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[#111110] mb-4">New Prospecting Run</h2>
          <form onSubmit={createRun} className="space-y-3">
            <div>
              <label htmlFor="run-name" className="block text-xs font-medium text-[#6b6866] mb-1">
                Run name
              </label>
              <input
                id="run-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Israel CTOs Q2 2026"
                className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="run-keywords" className="block text-xs font-medium text-[#6b6866] mb-1">
                  Search keywords
                </label>
                <input
                  id="run-keywords"
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="cto, vp r&d, ceo"
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
                />
              </div>
              <div>
                <label htmlFor="run-geo" className="block text-xs font-medium text-[#6b6866] mb-1">
                  Country
                </label>
                <select
                  id="run-geo"
                  value={geoCode}
                  onChange={(e) => setGeoCode(e.target.value)}
                  className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
                >
                  <option value="IL">🇮🇱 Israel</option>
                  <option value="US">🇺🇸 United States</option>
                  <option value="GB">🇬🇧 United Kingdom</option>
                  <option value="DE">🇩🇪 Germany</option>
                  <option value="FR">🇫🇷 France</option>
                  <option value="CA">🇨🇦 Canada</option>
                  <option value="AU">🇦🇺 Australia</option>
                  <option value="NL">🇳🇱 Netherlands</option>
                  <option value="IN">🇮🇳 India</option>
                  <option value="SG">🇸🇬 Singapore</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-[#9b9895]">
              Defaults: 15 requests/day, 100/week. 2nd-degree connections only.
            </p>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1585ff] hover:bg-[#0a70e0] rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              Create run
            </button>
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
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">Sent / Found</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">Caps (day / week)</th>
                  <th className="px-4 py-2.5" />
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
