"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pause, Play, Mail, MessageSquare } from "lucide-react";
import AutoRefresher from "@/components/auto-refresher";
import NewSequenceModal from "@/components/dashboard/new-sequence-modal";

type Step = { stepNumber: number; channel: string; dayOffset: number };
type Execution = { status: string; step: { stepNumber: number } };
type Sequence = {
  id: string;
  name: string;
  status: string;
  steps: Step[];
  contactList: { name: string };
  _count: { enrollments: number };
  enrollments: { executions: Execution[] }[];
};
type List = { id: string; name: string };
type Template = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  QUEUED: "Queued",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function currentStepNumber(enrollments: Sequence["enrollments"]): number | null {
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

function StepTimeline({ steps, currentStep }: { steps: Step[]; currentStep: number | null }) {
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
                <Mail className="w-2.5 h-2.5" />
              ) : (
                <MessageSquare className="w-2.5 h-2.5" />
              )}
              Step {step.stepNumber}
              {step.dayOffset > 0 && (
                <span className={isActive ? "text-blue-100" : "text-[#9b9895]"}>
                  ({step.dayOffset}d)
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <span className="text-[#c8c5c2] text-xs">→</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CampaignsClient({
  sequences,
  lists,
  templates,
}: {
  sequences: Sequence[];
  lists: List[];
  templates: Template[];
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  async function togglePause(seq: Sequence) {
    const action = seq.status === "ACTIVE" ? "pause" : "resume";
    await fetch(`/api/sequences/${seq.id}/${action}`, { method: "POST" });
    router.refresh();
  }

  return (
    <div className="p-8">
      <AutoRefresher />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">Campaigns</h1>
          <p className="text-sm text-[#6b6866] mt-0.5">
            Targeted outreach to contact lists
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#1585ff] text-white text-sm font-medium px-3.5 py-2 rounded-lg hover:bg-[#0f6fd4] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      {sequences.length === 0 ? (
        <div className="border border-dashed border-[#e5e3df] rounded-xl p-12 text-center">
          <p className="text-sm font-medium text-[#111110]">No campaigns yet</p>
          <p className="text-xs text-[#9b9895] mt-1">Create a campaign to start sending messages</p>
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
                    <p className="text-xs text-[#9b9895] mt-0.5">{seq.contactList.name}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-[#6b6866]">
                        {seq._count.enrollments} enrolled · {seq.steps.length} steps
                      </span>
                    </div>
                    <div className="mt-2">
                      <StepTimeline steps={seq.steps} currentStep={currentStep} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(canPause || canResume) && (
                      <button
                        onClick={() => togglePause(seq)}
                        className="p-1.5 text-[#9b9895] hover:text-[#6b6866] hover:bg-[#f3f2ef] rounded transition-colors"
                        title={canPause ? "Pause" : "Resume"}
                      >
                        {canPause ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    {/* TODO: add delete endpoint */}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <NewSequenceModal
          lists={lists}
          templates={templates}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
