"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pause, Play, Mail, MessageSquare, Trash2 } from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";
import { ExtensionStatusBadge } from "@/components/extension-status-badge";

type Step = { stepNumber: number; channel: string; dayOffset: number };
type Execution = { status: string; step: { stepNumber: number } };
type Sequence = {
  id: string;
  name: string;
  status: string;
  steps: Step[];
  contactList: { name: string } | null;
  _count: { enrollments: number };
  enrollments: { executions: Execution[] }[];
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

function currentStepNumber(
  enrollments: Sequence["enrollments"],
): number | null {
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

function StepTimeline({
  steps,
  currentStep,
}: {
  steps: Step[];
  currentStep: number | null;
}) {
  if (steps.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, i) => {
        const isActive = step.stepNumber === currentStep;
        return (
          <div key={step.stepNumber} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${
                isActive
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-surface text-[var(--muted)] border-[var(--line)]"
              }`}
            >
              {step.channel === "EMAIL" ? (
                <Mail className="size-2.5" />
              ) : (
                <MessageSquare className="size-2.5" />
              )}
              שלב {step.stepNumber}
              {step.dayOffset > 0 && (
                <span className={isActive ? "text-[var(--accent)]" : "text-[var(--faint)]"}>
                  ({step.dayOffset} ימים)
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <span className="text-[var(--faint)] text-xs">←</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const WA_STATUS_CONFIG = {
  CONNECTED:    { bg: "bg-[var(--success-soft)]", text: "text-[var(--success)]", dot: "bg-[var(--success)]", label: "WhatsApp מחובר" },
  QR_PENDING:   { bg: "bg-[var(--warning-soft)]", text: "text-[var(--warning)]", dot: "bg-[var(--warning)]", label: "WhatsApp ממתין" },
  DISCONNECTED: { bg: "bg-[var(--danger-soft)]", text: "text-[var(--danger)]", dot: "bg-[var(--danger)]", label: "WhatsApp לא מחובר" },
} as const;

function WhatsAppStatusBadge({ status }: { status: "CONNECTED" | "QR_PENDING" | "DISCONNECTED" }) {
  const cfg = WA_STATUS_CONFIG[status];
  const badge = (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`size-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
  return status !== "CONNECTED"
    ? <Link href="/settings/whatsapp">{badge}</Link>
    : badge;
}

export default function CampaignsClient({
  sequences,
  extensionLastSeen,
  extensionRevokedAt,
  whatsappStatus,
}: {
  sequences: Sequence[];
  extensionLastSeen: string | null;
  extensionRevokedAt: string | null;
  whatsappStatus: "CONNECTED" | "QR_PENDING" | "DISCONNECTED";
}) {
  const router = useRouter();
  const [deletingSeq, setDeletingSeq] = useState<Sequence | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function togglePause(seq: Sequence) {
    const action = seq.status === "ACTIVE" ? "pause" : "resume";
    await fetch(`/api/sequences/${seq.id}/${action}`, { method: "POST" });
    router.refresh();
  }

  async function deleteSequence(seq: Sequence) {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/sequences/${seq.id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError("מחיקה נכשלה — נסה שוב");
        return;
      }
      setDeletingSeq(null);
      router.refresh();
    } catch {
      setDeleteError("שגיאת רשת — נסה שוב");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="p-8">
      <AutoRefresher />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">קמפיינים</h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            פניות ממוקדות לרשימות אנשי קשר
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExtensionStatusBadge
            lastSeenAt={extensionLastSeen}
            revokedAt={extensionRevokedAt}
          />
          <WhatsAppStatusBadge status={whatsappStatus} />
          <Link
            href="/campaigns/new"
            className="bg-[var(--accent)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--accent)]"
          >
            + קמפיין חדש
          </Link>
        </div>
      </div>

      {sequences.length === 0 ? (
        <div className="border border-dashed border-[var(--line)] rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">
            אין קמפיינים עדיין
          </p>
          <p className="text-xs text-[var(--faint)] mt-1">
            צור קמפיין כדי להתחיל לשלוח הודעות
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map((seq) => {
            const currentStep = currentStepNumber(seq.enrollments);
            const canPause = seq.status === "ACTIVE";
            const canResume = seq.status === "PAUSED";
            return (
              <div
                key={seq.id}
                className="group border border-[var(--line)] rounded-[var(--radius-card)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-paper)] transition-colors hover:border-[var(--accent)]/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/campaigns/${seq.id}`}
                        className="font-semibold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
                      >
                        {seq.name}
                      </Link>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[seq.status] ?? ""}`}
                      >
                        {STATUS_LABELS[seq.status] ?? seq.status}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--faint)] mt-0.5">
                      {seq.contactList?.name}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-[var(--muted)]">
                        {seq._count.enrollments} אנשי קשר · {seq.steps.length}{" "}
                        שלבים
                      </span>
                    </div>
                    <div className="mt-2">
                      <StepTimeline
                        steps={seq.steps}
                        currentStep={currentStep}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(canPause || canResume) && (
                      <button
                        type="button"
                        onClick={() => togglePause(seq)}
                        className="p-1.5 text-[var(--faint)] hover:text-[var(--muted)] hover:bg-[var(--surface-secondary)] rounded transition-colors"
                        title={canPause ? "השהה" : "המשך"}
                      >
                        {canPause ? (
                          <Pause className="size-3.5" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeletingSeq(seq)}
                      className="fv-ring rounded p-1.5 text-[var(--faint)] opacity-0 transition-all hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] focus-visible:opacity-100 group-hover:opacity-100"
                      title="מחק קמפיין"
                      aria-label={`מחק את הקמפיין ${seq.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deletingSeq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" aria-hidden="true" onClick={() => { setDeletingSeq(null); setDeleteError(null); }}>
          <div className="bg-surface rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-[var(--foreground)] mb-1">מחיקת קמפיין</h2>
            <p className="text-sm text-[var(--muted)] mb-3">
              האם למחוק את <span className="font-medium text-[var(--foreground)]">{deletingSeq.name}</span>?
            </p>
            {["ACTIVE", "QUEUED", "PAUSED"].includes(deletingSeq.status) && (
              <p className="text-xs text-[var(--warning)] bg-[var(--warning-soft)] border border-[var(--warning)]/30 rounded-md px-3 py-2 mb-4">
                הקמפיין עדיין פעיל — מחיקה תעצור אותו לאלתר
              </p>
            )}
            {deleteError && (
              <p className="text-xs text-[var(--danger)] mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeletingSeq(null); setDeleteError(null); }}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm text-[var(--muted)] border border-[var(--line)] rounded-lg hover:bg-[var(--surface-secondary)] transition-colors"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => deleteSequence(deletingSeq)}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm font-medium text-white bg-[var(--danger)] hover:bg-[var(--danger)] rounded-lg transition-colors disabled:opacity-50"
              >
                {deleteLoading ? "מוחק…" : "מחק"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
