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
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
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
                  ? "bg-[#1585ff] text-white border-[#1585ff]"
                  : "bg-white text-[#6b6866] border-[#e5e3df]"
              }`}
            >
              {step.channel === "EMAIL" ? (
                <Mail className="size-2.5" />
              ) : (
                <MessageSquare className="size-2.5" />
              )}
              שלב {step.stepNumber}
              {step.dayOffset > 0 && (
                <span className={isActive ? "text-blue-100" : "text-[#9b9895]"}>
                  ({step.dayOffset} ימים)
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <span className="text-[#c8c5c2] text-xs">←</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const WA_STATUS_CONFIG = {
  CONNECTED:    { bg: "bg-[#e6faf0]", text: "text-[#059669]", dot: "bg-[#059669]", label: "WhatsApp מחובר" },
  QR_PENDING:   { bg: "bg-[#fff7e6]", text: "text-[#b45309]", dot: "bg-[#b45309]", label: "WhatsApp ממתין" },
  DISCONNECTED: { bg: "bg-[#fff3f3]", text: "text-[#dc2626]", dot: "bg-[#dc2626]", label: "WhatsApp לא מחובר" },
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
          <h1 className="text-xl font-semibold text-[#111110]">קמפיינים</h1>
          <p className="text-sm text-[#6b6866] mt-0.5">
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
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            + קמפיין חדש
          </Link>
        </div>
      </div>

      {sequences.length === 0 ? (
        <div className="border border-dashed border-[#e5e3df] rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-[#111110]">
            אין קמפיינים עדיין
          </p>
          <p className="text-xs text-[#9b9895] mt-1">
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
                className="border border-[#e5e3df] rounded-xl bg-white px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/campaigns/${seq.id}`}
                        className="font-semibold text-[#111110] hover:text-[#1585ff] transition-colors"
                      >
                        {seq.name}
                      </Link>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[seq.status] ?? ""}`}
                      >
                        {STATUS_LABELS[seq.status] ?? seq.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#9b9895] mt-0.5">
                      {seq.contactList?.name}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-[#6b6866]">
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
                        className="p-1.5 text-[#9b9895] hover:text-[#6b6866] hover:bg-[#f3f2ef] rounded transition-colors"
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
                      className="p-1.5 text-[#9b9895] hover:text-red-400 hover:bg-red-50 rounded transition-colors"
                      title="מחק קמפיין"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setDeletingSeq(null); setDeleteError(null); }}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-semibold text-[#111110] mb-1">מחיקת קמפיין</h2>
            <p className="text-sm text-[#6b6866] mb-3">
              האם למחוק את <span className="font-medium text-[#111110]">{deletingSeq.name}</span>?
            </p>
            {["ACTIVE", "QUEUED", "PAUSED"].includes(deletingSeq.status) && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-4">
                הקמפיין עדיין פעיל — מחיקה תעצור אותו לאלתר
              </p>
            )}
            {deleteError && (
              <p className="text-xs text-red-500 mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDeletingSeq(null); setDeleteError(null); }}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm text-[#6b6866] border border-[#e5e3df] rounded-lg hover:bg-[#f3f2ef] transition-colors"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => deleteSequence(deletingSeq)}
                disabled={deleteLoading}
                className="px-4 py-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
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
