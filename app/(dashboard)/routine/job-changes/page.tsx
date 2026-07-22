"use client";

import useSWR from "swr";
import Link from "next/link";
import {
  PartyPopper, Loader2, ExternalLink, Building2, BadgeCheck, Send, ScanLine,
} from "lucide-react";
import { coveragePct, estimateFullPassDays } from "@/lib/job-check/stats-pure";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";

type ScannedRow = {
  id: string;
  fullName: string;
  linkedinUrl: string;
  currentTitle: string | null;
  currentCompany: string | null;
  lastJobCheckAt: string;
  nextCheckAt: string;
  hasChange: boolean;
};

type JobChangeStats = {
  scannedThisMonth: number;
  eligibleTotal: number;
  coveredLast28d: number;
  dueNow: number;
  changedCompanyThisMonth: number;
  changedRoleThisMonth: number;
  pendingReview: number;
  dailyThroughput: number;
  recentlyScanned: ScannedRow[];
};

const fetcher = (u: string) => fetch(u).then((r) => r.json());

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
}

export default function JobChangesDashboard() {
  const { data, isLoading } = useSWR<JobChangeStats>(
    "/api/job-changes/stats",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const { modules, setModule } = useRoutineModules();
  const jobChecksOn = modules?.jobChecksEnabled ?? false;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <PartyPopper className="w-5 h-5 text-[#c2410c]" />
          <h1 className="text-lg font-semibold">עדכוני משתמשים — סקירה</h1>
        </div>
        {modules && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className={`text-xs font-medium ${jobChecksOn ? "text-[#059669]" : "text-[#b45309]"}`}>
              {jobChecksOn ? "המודול פעיל" : "המודול כבוי"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={jobChecksOn}
              aria-label="הפעלת מודול עדכוני משתמשים"
              onClick={() => setModule("jobChecks", !jobChecksOn)}
              dir="ltr"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${jobChecksOn ? "bg-[#059669]" : "bg-gray-300"}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${jobChecksOn ? "translate-x-[22px]" : "translate-x-[2px]"}`}
              />
            </button>
          </label>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-gray-500 p-5">
          <Loader2 className="w-4 h-4 animate-spin" /> טוען…
        </div>
      ) : (
        <div className="flex-1 p-5 flex flex-col gap-5">
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard icon={ScanLine} label="נסרקו החודש" value={data.scannedThisMonth} />
            <StatCard
              icon={ScanLine}
              label="כיסוי חודשי"
              value={`${coveragePct(data.coveredLast28d, data.eligibleTotal)}%`}
            />
            <StatCard icon={ScanLine} label="ממתינים לבדיקה כעת" value={data.dueNow} />
            <StatCard
              icon={Building2}
              label="החליפו חברה (החודש)"
              value={data.changedCompanyThisMonth}
              href="/routine/job-changes/feed?filter=company"
            />
            <StatCard
              icon={BadgeCheck}
              label="החליפו תפקיד (החודש)"
              value={data.changedRoleThisMonth}
              href="/routine/job-changes/feed?filter=role"
            />
            <StatCard
              icon={Send}
              label="ממתין לשליחה"
              value={data.pendingReview}
              href="/routine/job-changes/feed?filter=pending"
            />
          </div>

          {/* Coverage bar + rate */}
          <div className="bg-white rounded-lg border border-[#e5e3df] p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">כיסוי חודשי (28 יום)</span>
              <span className="text-gray-500">
                {data.coveredLast28d}/{data.eligibleTotal}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[#e5e3df] overflow-hidden">
              <div
                className="h-full bg-[#c2410c]"
                style={{ width: `${coveragePct(data.coveredLast28d, data.eligibleTotal)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              ~{data.dailyThroughput} ליום · סבב מלא מסתיים בעוד ~
              {estimateFullPassDays(data.dueNow, data.dailyThroughput)} ימים
            </p>
          </div>

          {/* Recently scanned table */}
          <ScannedTable rows={data.recentlyScanned} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof ScanLine;
  label: string;
  value: number | string;
  href?: string;
}) {
  const inner = (
    <div className="bg-white rounded-lg border border-[#e5e3df] p-4 h-full flex flex-col gap-1 transition-colors hover:border-[#c2410c]">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-2xl font-semibold text-[#111110]">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ScannedTable({ rows }: { rows: ScannedRow[] }) {
  if (rows.length === 0) {
    return <p className="text-gray-500">עוד לא נסרקו אנשי קשר.</p>;
  }
  return (
    <div className="bg-white rounded-lg border border-[#e5e3df] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e5e3df] text-sm font-medium">
        מי נסרק ומתי הבדיקה הבאה
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 bg-[#f6f5f3]">
          <tr>
            <th className="text-right px-4 py-2 font-medium">שם</th>
            <th className="text-right px-4 py-2 font-medium">תפקיד / חברה</th>
            <th className="text-right px-4 py-2 font-medium">נבדק לאחרונה</th>
            <th className="text-right px-4 py-2 font-medium">בדיקה הבאה</th>
            <th className="text-right px-4 py-2 font-medium">שינוי</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[#e5e3df]">
              <td className="px-4 py-2">
                <a
                  href={r.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0a66c2] inline-flex items-center gap-1"
                >
                  {r.fullName} <ExternalLink className="w-3 h-3" />
                </a>
              </td>
              <td className="px-4 py-2 text-gray-700">
                {[r.currentTitle, r.currentCompany].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="px-4 py-2 text-gray-500">{fmtDate(r.lastJobCheckAt)}</td>
              <td className="px-4 py-2 text-gray-500">{fmtDate(r.nextCheckAt)}</td>
              <td className="px-4 py-2">{r.hasChange ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
