"use client";

import { use } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ArrowRight, Loader2 } from "lucide-react";

type ConnectionRequest = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  linkedinUrl: string | null;
  sentAt: string;
};

type RunDetail = {
  name: string;
  status: string;
  totalSent: number;
  totalDiscovered: number;
};

type TaskStats = {
  search: { pending: number; done: number; failed: number };
  connect: { pending: number; done: number; failed: number; skipped: number };
  recentFailures: { kind: string; errorCode: string | null; errorMessage: string | null; at: string }[];
  lastActivity: string | null;
};

type RunDetailResponse = {
  run: RunDetail;
  requests: ConnectionRequest[];
  taskStats: TaskStats;
};

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

export default function ProspectingRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data } = useSWR<RunDetailResponse>(
    `/api/prospecting/runs/${id}`,
    fetcher,
    { refreshInterval: 15000 }
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-[#9b9895]" />
      </div>
    );
  }

  const { run, requests, taskStats } = data;

  return (
    <div dir="rtl" className="flex flex-col h-full min-h-screen bg-[#f6f5f3]">
      {/* Header */}
      <div className="relative flex items-center px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <Link href="/prospecting" className="text-[#9b9895] hover:text-[#6b6866] transition-colors absolute right-5">
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
        {/* Task status panel */}
        {taskStats && (
          <div className="bg-white border border-[#e5e3df] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">פעילות התוסף</h2>
              {taskStats.lastActivity && (
                <span className="text-xs text-[#9b9895]">
                  נראה לאחרונה: {new Date(taskStats.lastActivity).toLocaleString("he-IL")}
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
                  {taskStats.recentFailures.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-[#9b9895] font-mono">{f.kind}</span>
                      <span className="font-mono text-[#dc2626] bg-[#fff3f3] px-1.5 py-0.5 rounded">{f.errorCode}</span>
                      {f.errorMessage && (
                        <span className="text-[#6b6866] truncate max-w-xs">{f.errorMessage}</span>
                      )}
                      <span className="text-[#9b9895] ms-auto">{new Date(f.at).toLocaleTimeString("he-IL")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-[#e5e3df] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e5e3df] bg-[#fafaf9]">
            <h2 className="text-xs font-semibold text-[#9b9895] uppercase tracking-wider">
              בקשות חברות שנשלחו ({requests.length})
            </h2>
          </div>

          {requests.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[#9b9895]">עדיין לא נשלחו בקשות חברות.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e5e3df]">
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">שם</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">תפקיד</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">חברה</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">מיקום</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-[#9b9895] uppercase tracking-wider">נשלח</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e3df]">
                {requests.map((req) => (
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
                      {new Date(req.sentAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
