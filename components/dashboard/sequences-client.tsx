"use client";

import { useState } from "react";
import Link from "next/link";
import { GitBranch, Plus } from "lucide-react";
import NewSequenceModal from "./new-sequence-modal";

type Step = { stepNumber: number; channel: string; dayOffset: number };
type Sequence = {
  id: string;
  name: string;
  status: string;
  createdAt: Date | string;
  steps: Step[];
  contactList: { name: string };
  _count: { enrollments: number };
};
type List = { id: string; name: string };
type Template = { id: string; name: string; body: string };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-[#f3f2ef] text-[#6b6866]",
  QUEUED: "bg-[#fff7e6] text-[#b45309]",
  ACTIVE: "bg-[#e6f4ff] text-[#1585ff]",
  PAUSED: "bg-[#fff3f3] text-[#dc2626]",
  COMPLETED: "bg-[#e6faf0] text-[#059669]",
  CANCELLED: "bg-[#f3f2ef] text-[#9b9895]",
};

export default function SequencesClient({
  sequences,
  lists,
  templates,
}: {
  sequences: Sequence[];
  lists: List[];
  templates: Template[];
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111110]">Sequences</h1>
          <p className="text-sm text-[#6b6866] mt-0.5">
            Multi-step outreach campaigns with scheduled follow-ups
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#1585ff] text-white text-sm font-medium px-3.5 py-2 rounded-lg hover:bg-[#0f6fd4] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Sequence
        </button>
      </div>

      {sequences.length === 0 ? (
        <div className="border border-dashed border-[#e5e3df] rounded-xl p-12 text-center">
          <GitBranch className="w-8 h-8 text-[#c8c5c2] mx-auto mb-3" />
          <p className="text-sm font-medium text-[#111110]">No sequences yet</p>
          <p className="text-xs text-[#9b9895] mt-1">
            Create a sequence to send multi-step outreach campaigns
          </p>
        </div>
      ) : (
        <div className="border border-[#e5e3df] rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e3df] bg-[#fafaf9]">
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">List</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Steps</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Contacts</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-[#6b6866] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f3f2ef]">
              {sequences.map((seq) => (
                <tr key={seq.id} className="hover:bg-[#fafaf9] transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/sequences/${seq.id}`} className="font-medium text-[#111110] hover:text-[#1585ff]">
                      {seq.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#6b6866]">{seq.contactList.name}</td>
                  <td className="px-4 py-3 text-[#6b6866]">
                    {seq.steps.length} step{seq.steps.length !== 1 ? "s" : ""}
                    {seq.steps.length > 0 && (
                      <span className="ml-1.5 text-[#9b9895]">
                        ({seq.steps.map((s) => `Day ${s.dayOffset + 1}`).join(" → ")})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#6b6866]">{seq._count.enrollments}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[seq.status] ?? ""}`}
                    >
                      {seq.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewSequenceModal
          lists={lists}
          templates={templates}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
