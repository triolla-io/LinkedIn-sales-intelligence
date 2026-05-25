"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Pause, RotateCcw, XCircle, Mail } from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";

type StepExecution = {
  status: string;
  sentAt: Date | string | null;
  scheduledAt: Date | string | null;
  step: { stepNumber: number; channel: string; dayOffset: number };
};
type Enrollment = {
  id: string;
  status: string;
  enrolledAt: Date | string;
  contact: { fullName: string; currentTitle: string | null; currentCompany: string | null };
  executions: StepExecution[];
};
type SequenceStep = {
  id: string;
  stepNumber: number;
  dayOffset: number;
  channel: string;
  subject: string | null;
  template: { name: string };
};
type Sequence = {
  id: string;
  name: string;
  status: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  contactList: { name: string };
  steps: SequenceStep[];
  enrollments: Enrollment[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
};

const EXEC_COLORS: Record<string, string> = {
  PENDING: "bg-[#f3f2ef] text-[#6b6866]",
  SENDING: "bg-[#fff7e6] text-[#b45309]",
  SENT: "bg-[#e6faf0] text-[#059669]",
  FAILED: "bg-[#fff3f3] text-[#dc2626]",
  SKIPPED: "bg-[#f3f2ef] text-[#9b9895]",
};

function formatScheduled(scheduledAt: Date | string | null): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  const dateStr = d.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const timeStr = d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return `${dateStr} ${timeStr} (מאוחר)`;
  const diffH = Math.round(diffMs / 3_600_000);
  if (diffH < 24) return `${dateStr} ${timeStr} (בעוד ${diffH}h)`;
  const diffDays = Math.round(diffMs / 86_400_000);
  return `${dateStr} ${timeStr} (בעוד ${diffDays} ימים)`;
}

export default function SequenceDetailClient({ sequence }: { sequence: Sequence }) {
  const [status, setStatus] = useState(sequence.status);
  const [acting, setActing] = useState(false);

  async function doAction(action: "start" | "pause" | "resume" | "cancel") {
    setActing(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? "Action failed");
        return;
      }
      const nextStatus: Record<string, string> = {
        start: "QUEUED",
        pause: "PAUSED",
        resume: "ACTIVE",
        cancel: "CANCELLED",
      };
      setStatus(nextStatus[action]);
    } finally {
      setActing(false);
    }
  }

  const sentCount = sequence.enrollments.reduce(
    (acc, e) => acc + e.executions.filter((x) => x.status === "SENT").length,
    0
  );

  return (
    <div className="p-8 space-y-6">
      <AutoRefresher />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/sequences" className="text-[#9b9895] hover:text-[#111110] mt-0.5 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[#111110]">{sequence.name}</h1>
            <p className="text-sm text-[#6b6866] mt-0.5">רשימה: {sequence.contactList.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}>
            {status === "DRAFT" ? "טיוטה" : status === "QUEUED" ? "בתור" : status === "ACTIVE" ? "פעיל" : status === "PAUSED" ? "מושהה" : status === "COMPLETED" ? "הושלם" : status === "CANCELLED" ? "בוטל" : status}
          </span>
          {status === "DRAFT" && (
            <button
              onClick={() => doAction("start")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              התחל
            </button>
          )}
          {status === "ACTIVE" && (
            <button
              onClick={() => doAction("pause")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#f3f2ef] text-[#6b6866] text-sm font-medium rounded-lg hover:bg-[#e5e3df] transition-colors disabled:opacity-50"
            >
              <Pause className="w-3.5 h-3.5" />
              השהה
            </button>
          )}
          {status === "PAUSED" && (
            <button
              onClick={() => doAction("resume")}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              המשך
            </button>
          )}
          {["ACTIVE", "PAUSED", "QUEUED"].includes(status) && (
            <button
              onClick={() => { if (confirm("בטל את הרצף הזה?")) doAction("cancel"); }}
              disabled={acting}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#fff3f3] text-[#dc2626] text-sm font-medium rounded-lg hover:bg-[#fee2e2] transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              בטל
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "אנשי קשר", value: sequence.enrollments.length },
          { label: "הודעות שנשלחו", value: sentCount },
          { label: "שלבים", value: sequence.steps.length },
        ].map(({ label, value }) => (
          <div key={label} className="border border-[#e5e3df] rounded-xl p-4 bg-white">
            <p className="text-xs text-[#9b9895] uppercase tracking-wider font-semibold">{label}</p>
            <p className="text-2xl font-semibold text-[#111110] mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Step timeline */}
      <div className="border border-[#e5e3df] rounded-xl bg-white p-5">
        <h2 className="text-sm font-semibold text-[#111110] mb-4">שלבים</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {sequence.steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-0 shrink-0">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full border-2 border-[#1585ff] bg-[#eff5ff] flex items-center justify-center shrink-0">
                    {step.channel === "EMAIL" ? (
                      <Mail className="w-3.5 h-3.5 text-[#1585ff]" />
                    ) : (
                      <svg className="w-3.5 h-3.5 text-[#1585ff]" viewBox="0 0 448 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>
                      </svg>
                    )}
                  </div>
                  {i < sequence.steps.length - 1 && (
                    <div className="h-0.5 w-8 bg-[#e5e3df]" />
                  )}
                </div>
                <div className="min-w-[140px] mt-2 pr-4">
                  <p className="text-xs font-semibold text-[#111110]">
                    יום {step.dayOffset + 1} — {step.channel === "EMAIL" ? "דוא״ל" : "WhatsApp"}
                  </p>
                  {sequence.startedAt && (
                    <p className="text-[10px] text-[#9b9895] mt-0.5">
                      {new Date(
                        new Date(sequence.startedAt).getTime() + step.dayOffset * 86_400_000
                      ).toLocaleDateString("he-IL", {
                        day: "2-digit",
                        month: "2-digit",
                        timeZone: "Asia/Jerusalem",
                      })}
                    </p>
                  )}
                  <p className="text-xs text-[#6b6866] mt-0.5">{step.template.name}</p>
                  {step.subject && <p className="text-xs text-[#9b9895] mt-0.5 italic">&ldquo;{step.subject}&rdquo;</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enrollment table */}
      {sequence.enrollments.length > 0 && (
        <div className="border border-[#e5e3df] rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-3 border-b border-[#e5e3df] bg-[#fafaf9]">
            <h2 className="text-sm font-semibold text-[#111110]">
              אנשי קשר ({sequence.enrollments.length})
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f3f2ef]">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">איש קשר</th>
                {sequence.steps.map((step) => (
                  <th key={step.id} className="text-center px-3 py-2.5 text-xs font-semibold text-[#6b6866] uppercase tracking-wider whitespace-nowrap">
                    שלב {step.stepNumber}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f2ef]">
              {sequence.enrollments.map((enr) => (
                <tr key={enr.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#111110]">{enr.contact.fullName}</p>
                    <p className="text-xs text-[#9b9895]">
                      {enr.contact.currentTitle}
                      {enr.contact.currentCompany ? ` · ${enr.contact.currentCompany}` : ""}
                    </p>
                  </td>
                  {sequence.steps.map((step) => {
                    const exec = enr.executions.find((x) => x.step.stepNumber === step.stepNumber);
                    return (
                      <td key={step.id} className="px-3 py-3 text-center">
                        {exec ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}>
                              {exec.status === "PENDING" ? "ממתין" : exec.status === "SENDING" ? "משדר" : exec.status === "SENT" ? "נשלח" : exec.status === "FAILED" ? "נכשל" : exec.status === "SKIPPED" ? "דלוג" : exec.status}
                            </span>
                            {exec.status === "PENDING" && exec.scheduledAt && (
                              <span className="text-[10px] text-[#9b9895] whitespace-nowrap">
                                {formatScheduled(exec.scheduledAt)}
                              </span>
                            )}
                            {exec.status === "SENT" && exec.sentAt && (
                              <span className="text-[10px] text-[#9b9895] whitespace-nowrap">
                                {new Date(exec.sentAt).toLocaleDateString("he-IL", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  timeZone: "Asia/Jerusalem",
                                })}{" "}
                                {new Date(exec.sentAt).toLocaleTimeString("he-IL", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jerusalem",
                                })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#c8c5c2] text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
