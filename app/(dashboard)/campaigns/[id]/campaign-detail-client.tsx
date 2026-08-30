"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  XCircle,
  Mail,
  MessageSquare,
  Link2,
  X,
  RefreshCw,
  Plus,
} from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";

type StepExecution = {
  status: string;
  sentAt: Date | string | null;
  scheduledAt: Date | string | null;
  step: { stepNumber: number; channel: string; dayOffset: number };
};
type Enrollment = {
  id: string;
  contactId: string;
  status: string;
  enrolledAt: Date | string;
  contact: {
    fullName: string;
    currentTitle: string | null;
    currentCompany: string | null;
  };
  executions: StepExecution[];
};
type SequenceStep = {
  id: string;
  stepNumber: number;
  dayOffset: number;
  sendHour: number;
  sendMinute: number;
  channel: string;
  subject: string | null;
  template: { name: string };
};
type Sequence = {
  id: string;
  name: string;
  status: string;
  startedAt: Date | string | null;
  contactList: { name: string } | null;
  steps: SequenceStep[];
  enrollments: Enrollment[];
};

type ContactOption = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[var(--surface-secondary)] text-[var(--muted)]",
  QUEUED: "bg-[var(--warning-soft)] text-[var(--warning)]",
  ACTIVE: "bg-[var(--accent-soft)] text-[var(--accent)]",
  PAUSED: "bg-[var(--neutral-soft)] text-[var(--muted)]",
  COMPLETED: "bg-[var(--success-soft)] text-[var(--success)]",
  CANCELLED: "bg-[var(--surface-secondary)] text-[var(--faint)]",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "טיוטה",
  QUEUED: "בתור",
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  COMPLETED: "הושלם",
  CANCELLED: "בוטל",
};

const EXEC_COLORS: Record<string, string> = {
  PENDING: "bg-[var(--surface-secondary)] text-[var(--muted)]",
  QUEUED: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  SENDING: "bg-[var(--warning-soft)] text-[var(--warning)]",
  SENT: "bg-[var(--success-soft)] text-[var(--success)]",
  FAILED: "bg-[var(--danger-soft)] text-[var(--danger)]",
  SKIPPED: "bg-[var(--surface-secondary)] text-[var(--faint)]",
};

function nextStepDate(executions: Array<{ status: string; scheduledAt: Date | string | null }>): string {
  const pending = executions.find((x) => x.status === "PENDING");
  if (!pending || !pending.scheduledAt) return "—";
  return new Date(pending.scheduledAt).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

function RecipientsTable({
  sequence,
  enrollments,
  selectedIds,
  removing,
  activeStep,
  onToggleSelect,
  onToggleAll,
  onRemoveSingle,
  onRemoveBulk,
  onOpenEnrollModal,
}: {
  sequence: Sequence;
  enrollments: Enrollment[];
  selectedIds: Set<string>;
  removing: boolean;
  activeStep: number | null;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onRemoveSingle: (id: string) => void;
  onRemoveBulk: () => void;
  onOpenEnrollModal: () => void;
}) {
  return (
    <div className="border border-[var(--line)] rounded-xl overflow-hidden bg-surface">
      <div className="px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-secondary)] flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">
          אנשי קשר ({enrollments.length})
        </h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={onRemoveBulk}
              disabled={removing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-medium rounded-lg hover:bg-[var(--danger-soft)] transition-colors disabled:opacity-50"
            >
              <X className="size-3" />
              הסר מהקמפיין ({selectedIds.size})
            </button>
          )}
          <button
            type="button"
            onClick={onOpenEnrollModal}
            className="flex items-center gap-2 bg-[var(--accent)] text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--accent-strong)] transition-colors"
          >
            <Plus size={16} />
            הוסף אנשי קשר
          </button>
        </div>
      </div>
      {enrollments.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--faint)]">אין אנשי קשר רשומים</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--surface-secondary)]">
              <th className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  checked={
                    selectedIds.size === enrollments.length &&
                    enrollments.length > 0
                  }
                  onChange={onToggleAll}
                  aria-label="בחר את כל אנשי הקשר"
                  className="rounded border-[var(--line)]"
                />
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
                איש קשר
              </th>
              {sequence.steps.map((step) => (
                <th
                  key={step.id}
                  className={`text-center px-3 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                    step.stepNumber === activeStep
                      ? "text-[var(--accent)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  שלב {step.stepNumber}
                </th>
              ))}
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-[var(--muted)] uppercase tracking-wider whitespace-nowrap">
                שלב הבא
              </th>
              <th className="w-10" aria-label="פעולות" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--surface-secondary)]">
            {enrollments.map((enr) => (
              <tr key={enr.id} className="hover:bg-[var(--surface-secondary)]">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(enr.id)}
                    onChange={() => onToggleSelect(enr.id)}
                    aria-label={`בחר ${enr.contact.fullName}`}
                    className="rounded border-[var(--line)]"
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--foreground)]">
                    {enr.contact.fullName}
                  </p>
                  <p className="text-xs text-[var(--faint)]">
                    {enr.contact.currentTitle}
                    {enr.contact.currentCompany
                      ? ` · ${enr.contact.currentCompany}`
                      : ""}
                  </p>
                </td>
                {sequence.steps.map((step) => {
                  const exec = enr.executions.find(
                    (x) => x.step.stepNumber === step.stepNumber,
                  );
                  return (
                    <td key={step.id} className="p-3 text-center">
                      {exec ? (
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EXEC_COLORS[exec.status] ?? ""}`}
                        >
                          {exec.status}
                        </span>
                      ) : (
                        <span className="text-[var(--faint)] text-xs">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="p-3 text-center text-xs text-[var(--muted)]">
                  {nextStepDate(enr.executions)}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemoveSingle(enr.id)}
                      disabled={removing}
                      className="p-1 text-[var(--faint)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] rounded transition-colors disabled:opacity-50"
                      title="הסר מהקמפיין"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RemovedRecipients({
  enrollments,
  removing,
  onRestoreSingle,
}: {
  enrollments: Enrollment[];
  removing: boolean;
  onRestoreSingle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (enrollments.length === 0) return null;
  return (
    <div className="border border-[var(--line)] rounded-xl overflow-hidden bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-5 py-3 bg-[var(--surface-secondary)] flex items-center justify-between text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
      >
        <span>הוסרו מהקמפיין ({enrollments.length})</span>
        <span className="text-xs font-normal text-[var(--faint)]">{open ? "הסתר" : "הצג"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-[var(--surface-secondary)]">
          {enrollments.map((enr) => (
            <li key={enr.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--muted)]">{enr.contact.fullName}</p>
                <p className="text-xs text-[var(--faint)]">
                  {enr.contact.currentTitle}
                  {enr.contact.currentCompany ? ` · ${enr.contact.currentCompany}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRestoreSingle(enr.id)}
                disabled={removing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent-soft)] rounded-lg transition-colors disabled:opacity-50"
                title="החזר לקמפיין"
              >
                <RefreshCw className="size-3.5" />
                החזר
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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

function SequenceHeader({
  sequence,
  acting,
  onAction,
}: {
  sequence: Sequence;
  acting: boolean;
  onAction: (action: "start" | "pause" | "resume" | "cancel") => void;
}) {
  const { status } = sequence;
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3">
        <Link
          href="/campaigns"
          className="text-[var(--faint)] hover:text-[var(--foreground)] mt-0.5 transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">
            {sequence.name}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            רשימה: {sequence.contactList?.name ?? "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href={`/campaigns/${sequence.id}/edit`}
          className="border border-[var(--line)] rounded-lg px-3 py-2 text-sm text-[var(--ink-strong)] hover:bg-[var(--surface-secondary)] transition-colors"
        >
          ערוך
        </Link>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? ""}`}
        >
          {STATUS_LABELS[status] ?? status}
        </span>
        {status === "DRAFT" && (
          <button
            type="button"
            onClick={() => onAction("start")}
            disabled={acting}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-strong)] transition-colors disabled:opacity-50"
          >
            <Play className="size-3.5" />
            התחל
          </button>
        )}
        {status === "ACTIVE" && (
          <button
            type="button"
            onClick={() => onAction("pause")}
            disabled={acting}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--surface-secondary)] text-[var(--muted)] text-sm font-medium rounded-lg hover:bg-[var(--line)] transition-colors disabled:opacity-50"
          >
            <Pause className="size-3.5" />
            השהה
          </button>
        )}
        {status === "PAUSED" && (
          <button
            type="button"
            onClick={() => onAction("resume")}
            disabled={acting}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--accent-strong)] transition-colors disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" />
            המשך
          </button>
        )}
        {["ACTIVE", "PAUSED", "QUEUED"].includes(status) && (
          <button
            type="button"
            onClick={() => {
              if (confirm("בטל את קמפיין זה?")) onAction("cancel");
            }}
            disabled={acting}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--danger-soft)] text-[var(--danger)] text-sm font-medium rounded-lg hover:bg-[var(--danger-soft)] transition-colors disabled:opacity-50"
          >
            <XCircle className="size-3.5" />
            בטל
          </button>
        )}
      </div>
    </div>
  );
}

function SequenceTimeline({
  steps,
  activeStep,
}: {
  steps: SequenceStep[];
  activeStep: number | null;
}) {
  return (
    <div className="border border-[var(--line)] rounded-xl bg-surface p-5">
      <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">שלבים</h2>
      <div className="flex overflow-x-auto pb-2">
        {steps.map((step, i) => {
          const isActive = step.stepNumber === activeStep;
          const timeStr = `${String(step.sendHour).padStart(2, "0")}:${String(step.sendMinute).padStart(2, "0")}`;
          return (
            <div
              key={step.id}
              className="flex flex-col items-center shrink-0 min-w-[160px]"
            >
              <div className="flex items-center w-full">
                <div
                  className={`flex-1 h-0.5 ${i > 0 ? "bg-[var(--line)]" : "bg-transparent"}`}
                />
                <div
                  className={`size-8 rounded-full border-2 flex items-center justify-center shrink-0 ${isActive ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--accent)] bg-[var(--accent-soft)]"}`}
                >
                  {step.channel === "EMAIL" ? (
                    <Mail
                      className={`size-3.5 ${isActive ? "text-white" : "text-[var(--accent)]"}`}
                    />
                  ) : step.channel === "LINKEDIN" ? (
                    <Link2
                      className={`size-3.5 ${isActive ? "text-white" : "text-[var(--accent)]"}`}
                    />
                  ) : (
                    <MessageSquare
                      className={`size-3.5 ${isActive ? "text-white" : "text-[var(--accent)]"}`}
                    />
                  )}
                </div>
                <div
                  className={`flex-1 h-0.5 ${i < steps.length - 1 ? "bg-[var(--line)]" : "bg-transparent"}`}
                />
              </div>
              <div className="mt-2 text-center px-2 w-full">
                <p className="text-xs font-semibold text-[var(--foreground)]">
                  יום {step.dayOffset + 1}:{" "}
                  {step.channel === "EMAIL" ? "דוא״ל" : step.channel === "LINKEDIN" ? "LinkedIn" : "WhatsApp"}
                </p>
                <p className="text-[10px] text-[var(--faint)] mt-0.5">{timeStr}</p>
                {isActive && (
                  <p className="text-[10px] text-[var(--accent)] font-medium mt-0.5">
                    ← עכשיו
                  </p>
                )}
                <p className="text-xs text-[var(--muted)] mt-0.5 truncate">
                  {step.template.name}
                </p>
                {step.subject && (
                  <p className="text-xs text-[var(--faint)] mt-0.5 italic truncate">
                    &ldquo;{step.subject}&rdquo;
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignDetailClient({
  sequence: initial,
  contacts,
}: {
  sequence: Sequence;
  extensionLastSeen?: string | null;
  contacts: ContactOption[];
}) {
  const router = useRouter();
  const [sequence, setSequence] = useState<Sequence>(initial);
  // Sync fresh server data into local state whenever the server component
  // re-renders with new props (via router.refresh() / AutoRefresher). Without
  // this, useState(initial) keeps the first-mount value forever, so newly
  // created enrollments (built asynchronously by the sequence.start Inngest
  // job) never appear until a full page reload. Detect the prop change during
  // render — React's recommended pattern — to avoid a stale-data flash.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setSequence(initial);
  }
  const [acting, setActing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);

  // Enrollment modal state
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);

  // Split enrollments: removed people (UNSUBSCRIBED) drop out of the recipients
  // table and metrics, and live in a collapsible "removed" section instead.
  const activeEnrollments = sequence.enrollments.filter((e) => e.status !== "UNSUBSCRIBED");
  const removedEnrollments = sequence.enrollments.filter((e) => e.status === "UNSUBSCRIBED");

  // Metric card computations (over active enrollments only)
  const totalEnrolled = activeEnrollments.length;
  const completed = activeEnrollments.filter((e) => e.status === "COMPLETED").length;
  const inProgress = activeEnrollments.filter((e) => e.status === "ACTIVE").length;
  const failed = activeEnrollments.filter((e) =>
    e.executions.some((x) => x.status === "FAILED")
  ).length;

  // Enrollment modal computed values
  const enrolledContactIds = new Set(sequence.enrollments.map((e) => e.contactId));
  const filteredContacts = contacts.filter(
    (c) =>
      !enrolledContactIds.has(c.id) &&
      (enrollSearch ? c.fullName.toLowerCase().includes(enrollSearch.toLowerCase()) : true)
  );

  const activeStep = currentStepNumber(activeEnrollments);

  async function doAction(action: "start" | "pause" | "resume" | "cancel") {
    setActing(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/${action}`, {
        method: "POST",
      });
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

  async function doEnroll() {
    if (selectedContactIds.size === 0) return;
    setEnrolling(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: Array.from(selectedContactIds) }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowEnrollModal(false);
        setSelectedContactIds(new Set());
        if (data.newEnrollments?.length > 0) {
          setSequence((prev) => ({
            ...prev,
            enrollments: [...prev.enrollments, ...data.newEnrollments],
          }));
        }
        router.refresh(); // sync server state in background
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function removeSingle(enrollmentId: string) {
    if (!confirm("האם להסיר איש קשר זה מהקמפיין? הודעות שכבר נשלחו יישמרו, ולא יישלחו לו הודעות נוספות.")) return;
    setRemoving(true);
    try {
      await fetch(
        `/api/sequences/${sequence.id}/enrollments/${enrollmentId}/remove`,
        {
          method: "POST",
        },
      );
      setSequence((prev) => ({
        ...prev,
        enrollments: prev.enrollments.map((enr) =>
          enr.id === enrollmentId
            ? {
                ...enr,
                status: "UNSUBSCRIBED",
                executions: enr.executions.map((ex) =>
                  ex.status === "PENDING" ? { ...ex, status: "SKIPPED" } : ex,
                ),
              }
            : enr,
        ),
      }));
    } finally {
      setRemoving(false);
    }
  }

  async function restoreSingle(enrollmentId: string) {
    setRemoving(true);
    try {
      await fetch(
        `/api/sequences/${sequence.id}/enrollments/${enrollmentId}/restore`,
        {
          method: "POST",
        },
      );
      setSequence((prev) => ({
        ...prev,
        enrollments: prev.enrollments.map((enr) =>
          enr.id === enrollmentId
            ? {
                ...enr,
                status: "ACTIVE",
                executions: enr.executions.map((ex) =>
                  ex.status === "SKIPPED" ? { ...ex, status: "PENDING" } : ex,
                ),
              }
            : enr,
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
          selectedIds.has(enr.id)
            ? {
                ...enr,
                status: "UNSUBSCRIBED",
                executions: enr.executions.map((ex) =>
                  ex.status === "PENDING" ? { ...ex, status: "SKIPPED" } : ex,
                ),
              }
            : enr,
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
    if (selectedIds.size === activeEnrollments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeEnrollments.map((e) => e.id)));
    }
  }

  return (
    <div className="p-8 space-y-6">
      <AutoRefresher intervalMs={
        // Poll fast (5s) while the campaign is still "settling": just started
        // (QUEUED) or activated but enrollments are still being created by the
        // async sequence.start job, so participants appear on their own. Also
        // poll fast while any execution is live. Otherwise back off to 30s.
        sequence.status === "QUEUED" ||
        (sequence.status === "ACTIVE" && sequence.enrollments.length === 0) ||
        sequence.enrollments.some((e) =>
          e.executions.some((x) => x.status === "PENDING" || x.status === "QUEUED" || x.status === "SENDING")
        ) ? 5_000 : 30_000
      } />

      <SequenceHeader sequence={sequence} acting={acting} onAction={doAction} />

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "רשומים", value: totalEnrolled },
          { label: "הושלמו", value: completed },
          { label: "בתהליך", value: inProgress },
          { label: "נכשלו", value: failed },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface border border-[var(--line)] rounded-xl p-4">
            <p className="text-2xl font-semibold text-[var(--ink-strong)] tabular-nums">{value}</p>
            <p className="text-sm text-[var(--muted)] mt-1">{label}</p>
          </div>
        ))}
      </div>

      <SequenceTimeline steps={sequence.steps} activeStep={activeStep} />

      <RecipientsTable
        sequence={sequence}
        enrollments={activeEnrollments}
        selectedIds={selectedIds}
        removing={removing}
        activeStep={activeStep}
        onToggleSelect={toggleSelect}
        onToggleAll={toggleAll}
        onRemoveSingle={removeSingle}
        onRemoveBulk={removeBulk}
        onOpenEnrollModal={() => setShowEnrollModal(true)}
      />

      <RemovedRecipients
        enrollments={removedEnrollments}
        removing={removing}
        onRestoreSingle={restoreSingle}
      />

      {/* Manual enrollment modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-semibold">הוסף אנשי קשר לקמפיין</h3>
            <input
              type="text"
              aria-label="חיפוש אנשי קשר"
              value={enrollSearch}
              onChange={(e) => setEnrollSearch(e.target.value)}
              placeholder="חיפוש..."
              className="w-full bg-surface border border-[var(--line)] rounded-lg px-3 py-2 text-sm text-[var(--ink-strong)] placeholder-[var(--faint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/15 focus:border-[var(--accent)] transition"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredContacts.map((c) => (
                <label key={c.id} className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-[var(--surface-secondary)] cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedContactIds.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selectedContactIds);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setSelectedContactIds(next);
                    }}
                  />
                  <span className="text-sm text-[var(--ink-strong)]">{c.fullName}</span>
                  {c.currentTitle && (
                    <span className="text-xs text-[var(--faint)]">{c.currentTitle}</span>
                  )}
                </label>
              ))}
              {filteredContacts.length === 0 && (
                <p className="text-sm text-[var(--faint)] text-center py-4">אין תוצאות</p>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={doEnroll}
                disabled={enrolling || selectedContactIds.size === 0}
                className="flex-1 bg-[var(--accent)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--accent-strong)] transition-colors disabled:opacity-50"
              >
                {enrolling ? "מוסיף..." : `הוסף (${selectedContactIds.size})`}
              </button>
              <button
                type="button"
                onClick={() => setShowEnrollModal(false)}
                className="border border-[var(--line)] rounded-lg px-4 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-secondary)] transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
