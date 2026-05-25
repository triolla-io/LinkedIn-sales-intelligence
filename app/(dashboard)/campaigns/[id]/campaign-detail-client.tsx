"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Pause, RotateCcw, XCircle, Mail, MessageSquare, X } from "lucide-react";
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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "טיוטה",
  QUEUED: "ממתין",
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  COMPLETED: "הושלם",
  CANCELLED: "בוטל",
};

const EXEC_COLORS: Record<string, string> = {
  PENDING: "bg-[#f3f2ef] text-[#6b6866]",
  SENDING: "bg-[#fff7e6] text-[#b45309]",
  SENT: "bg-[#e6faf0] text-[#059669]",
  FAILED: "bg-[#fff3f3] text-[#dc2626]",
  SKIPPED: "bg-[#f3f2ef] text-[#9b9895]",
};

function currentStepNumber(enrollments: Enrollment[]): number | null {
  const counts: Record<number, number> = {};
  for (const enr of enrollments) {
    for (const ex of enr.executions) {
      if (ex.status === "PENDING") {
        counts[ex.step.stepNumber] = (counts[ex.step.stepNumber] ?? 0) + 1;
      }
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return Number(entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
}

export default function CampaignDetailClient({ sequence: initial }: { sequence: Sequence }) {
  const [sequence, setSequence] = useState<Sequence>(initial);
  const [acting, setActing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  const sentCount = sequence.enrollments.reduce(
    (acc, e) => acc + e.executions.filter((x) => x.status === "SENT").length,
    0
  );

  const activeStep = currentStepNumber(sequence.enrollments);

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
      setSequence((prev) => ({ ...prev, status: nextStatus[action] }));
    } finally {
      setActing(false);
    }
  }

  async function removeSingle(enrollmentId: string) {
    setRemoving(true);
    try {
      await fetch(`/api/sequences/${sequence.id}/enrollments/${enrollmentId}/remove`, {
        method: "POST",
      });
      setSequence((prev) => ({
        ...prev,
        enrollments: prev.enrollments.map((enr) =>
          enr.id === enrollmentId
            ? {
                ...enr,
                executions: enr.executions.map((ex) =>
                  ex.status === "PENDING" ? { ...ex, status: "SKIPPED" } : ex
                ),
              }
            : enr
        ),
      }));
    } finally {
      setRemoving(false);
    }
  }

  async function removeBulk() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setRemoving(true);
    try {
      await fetch(`/api/sequences/${sequence.id}/enrollments/remove-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentIds: ids }),
      });
      setSequence((prev) => ({
        ...prev,
        enrollments: prev.enrollments.map((enr) =>
          ids.includes(enr.id)
            ? {
                ...enr,
                executions: enr.executions.map((ex) =>
                  ex.status === "PENDING" ? { ...ex, status: "SKIPPED" } : ex
                ),
              }
            : enr
        ),
      }));
      setSelectedIds(new Set());
    } finally {
      setRemoving(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === sequence.enrollments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sequence.enrollments.map((e) => e.id)));
    }
  }

  const { status } = sequence;

  return (
    <div className="p-8 space-y-6">
      <AutoRefresher />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/campaigns" className="text-[#9b9895] hover:text-[#111110] mt-0.5 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[#111110]">{sequence.name}</h1>
            <p className="text-sm text-[#6b6866] mt-0.5">רשימה: {sequence.contactList.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}>
            {STATUS_LABELS[status] ?? status}
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
              onClick={() => { if (confirm("לבטל את הקמפיין?")) doAction("cancel"); }}
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
          { label: "רשומים", value: sequence.enrollments.length },
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
          {sequence.steps.map((step, i) => {
            const isActive = step.stepNumber === activeStep;
            return (
              <div key={step.id} className="flex items-start gap-0 shrink-0">
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isActive
                          ? "border-[#1585ff] bg-[#1585ff]"
                          : "border-[#1585ff] bg-[#eff5ff]"
                      }`}
                    >
                      {step.channel === "EMAIL" ? (
                        <Mail className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-[#1585ff]"}`} />
                      ) : (
                        <MessageSquare className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-[#1585ff]"}`} />
                      )}
                    </div>
                    {i < sequence.steps.length - 1 && (
                      <div className="h-0.5 w-8 bg-[#e5e3df]" />
                    )}
                  </div>
                  <div className="min-w-[140px] mt-2 pr-4">
                    <p className="text-xs font-semibold text-[#111110]">
                      יום {step.dayOffset + 1} — {step.channel === "EMAIL" ? "Email" : "WhatsApp"}
                      {isActive && (
                        <span className="ml-1.5 text-[10px] text-[#1585ff] font-medium">← עכשיו</span>
                      )}
                    </p>
                    <p className="text-xs text-[#6b6866] mt-0.5">{step.template.name}</p>
                    {step.subject && (
                      <p className="text-xs text-[#9b9895] mt-0.5 italic">&ldquo;{step.subject}&rdquo;</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Enrollment table */}
      {sequence.enrollments.length > 0 && (
        <div className="border border-[#e5e3df] rounded-xl overflow-hidden bg-white">
          <div className="px-5 py-3 border-b border-[#e5e3df] bg-[#fafaf9] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#111110]">
              אנשי קשר ({sequence.enrollments.length})
            </h2>
            {selectedIds.size > 0 && (
              <button
                onClick={removeBulk}
                disabled={removing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#fff3f3] text-[#dc2626] text-xs font-medium rounded-lg hover:bg-[#fee2e2] transition-colors disabled:opacity-50"
              >
                <X className="w-3 h-3" />
                הסר מהמשך ({selectedIds.size})
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f3f2ef]">
                <th className="px-4 py-2.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === sequence.enrollments.length && sequence.enrollments.length > 0}
                    onChange={toggleAll}
                    className="rounded border-[#e5e3df]"
                  />
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">איש קשר</th>
                {sequence.steps.map((step) => (
                  <th
                    key={step.id}
                    className={`text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                      step.stepNumber === activeStep ? "text-[#1585ff]" : "text-[#6b6866]"
                    }`}
                  >
                    שלב {step.stepNumber}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f2ef]">
              {sequence.enrollments.map((enr) => (
                <tr key={enr.id} className="hover:bg-[#fafaf9]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(enr.id)}
                      onChange={() => toggleSelect(enr.id)}
                      className="rounded border-[#e5e3df]"
                    />
                  </td>
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
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}>
                            {exec.status}
                          </span>
                        ) : (
                          <span className="text-[#c8c5c2] text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3">
                    <button
                      onClick={() => removeSingle(enr.id)}
                      disabled={removing}
                      className="p-1 text-[#c8c5c2] hover:text-[#dc2626] hover:bg-[#fff3f3] rounded transition-colors disabled:opacity-50"
                      title="הסר מהשלבים הבאים"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
