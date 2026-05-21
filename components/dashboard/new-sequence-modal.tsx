"use client";

import { useState } from "react";
import { X, Plus, Trash2, Mail, MessageSquare, ChevronUp, ChevronDown } from "lucide-react";

type List = { id: string; name: string };
type Template = { id: string; name: string; body: string };

type Step = {
  key: string;
  channel: "EMAIL" | "WHATSAPP";
  templateId: string;
  subject: string;
  dayOffset: number;
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function NewSequenceModal({
  lists,
  templates,
  onClose,
  onCreated,
}: {
  lists: List[];
  templates: Template[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [steps, setSteps] = useState<Step[]>([
    { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addStep() {
    const lastOffset = steps[steps.length - 1]?.dayOffset ?? 0;
    setSteps((prev) => [
      ...prev,
      { key: uid(), channel: "EMAIL", templateId: templates[0]?.id ?? "", subject: "", dayOffset: lastOffset + 2 },
    ]);
  }

  function removeStep(key: string) {
    setSteps((prev) => prev.filter((s) => s.key !== key));
  }

  function updateStep(key: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) { setError("Sequence name is required"); return; }
    if (!listId) { setError("Select a contact list"); return; }
    if (steps.length === 0) { setError("Add at least one step"); return; }
    for (const s of steps) {
      if (!s.templateId) { setError("Each step needs a template"); return; }
      if (s.channel === "EMAIL" && !s.subject.trim()) { setError("Email steps need a subject line"); return; }
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        contactListId: listId,
        steps: steps.map((s, i) => ({
          stepNumber: i + 1,
          dayOffset: s.dayOffset,
          channel: s.channel,
          templateId: s.templateId,
          subject: s.channel === "EMAIL" ? s.subject.trim() : undefined,
        })),
      };
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to create sequence");
      }

      const { sequence } = await res.json() as { sequence: { id: string } };
      const startRes = await fetch(`/api/sequences/${sequence.id}/start`, { method: "POST" });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to start sequence");
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (lists.length === 0 || templates.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#111110]">New Sequence</h2>
            <button onClick={onClose} className="text-[#9b9895] hover:text-[#111110] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-[#6b6866]">
            {lists.length === 0
              ? "You need at least one contact list before creating a sequence. Create a list first."
              : "You need at least one message template before creating a sequence. Create a template first."}
          </p>
          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e3df]">
          <h2 className="text-base font-semibold text-[#111110]">New Sequence</h2>
          <button onClick={onClose} className="text-[#9b9895] hover:text-[#111110] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[#6b6866] mb-1.5">Sequence Name</label>
            <input
              className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff]"
              placeholder="e.g. Q2 Outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Contact List */}
          <div>
            <label className="block text-xs font-medium text-[#6b6866] mb-1.5">Contact List</label>
            <select
              className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff]"
              value={listId}
              onChange={(e) => setListId(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#6b6866]">Steps</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1 text-xs text-[#1585ff] font-medium hover:text-[#0f6fd4]"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Step
              </button>
            </div>

            <div className="space-y-3">
              {steps.map((step, index) => (
                <div key={step.key} className="border border-[#e5e3df] rounded-xl p-4 space-y-3 bg-[#fafaf9]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#6b6866] uppercase tracking-wider">
                      Step {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-xs text-[#6b6866]">
                        <span>Day</span>
                        <button
                          onClick={() => updateStep(step.key, { dayOffset: Math.max(0, step.dayOffset - 1) })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-[#e5e3df] bg-white hover:bg-[#f3f2ef]"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-mono font-medium text-[#111110]">
                          {step.dayOffset + 1}
                        </span>
                        <button
                          onClick={() => updateStep(step.key, { dayOffset: step.dayOffset + 1 })}
                          className="w-5 h-5 flex items-center justify-center rounded border border-[#e5e3df] bg-white hover:bg-[#f3f2ef]"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                      </div>
                      {steps.length > 1 && (
                        <button
                          onClick={() => removeStep(step.key)}
                          className="text-[#c8c5c2] hover:text-[#dc2626] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Channel toggle */}
                  <div className="flex gap-2">
                    {(["EMAIL", "WHATSAPP"] as const).map((ch) => (
                      <button
                        key={ch}
                        onClick={() => updateStep(step.key, { channel: ch })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          step.channel === ch
                            ? "bg-[#1585ff] text-white border-[#1585ff]"
                            : "bg-white text-[#6b6866] border-[#e5e3df] hover:border-[#1585ff]"
                        }`}
                      >
                        {ch === "EMAIL" ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                        {ch === "EMAIL" ? "Email" : "WhatsApp"}
                      </button>
                    ))}
                  </div>

                  {/* Subject (email only) */}
                  {step.channel === "EMAIL" && (
                    <input
                      className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
                      placeholder="Subject line"
                      value={step.subject}
                      onChange={(e) => updateStep(step.key, { subject: e.target.value })}
                    />
                  )}

                  {/* Template */}
                  <select
                    className="w-full border border-[#e5e3df] rounded-lg px-3 py-2 text-sm text-[#111110] focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] bg-white"
                    value={step.templateId}
                    onChange={(e) => updateStep(step.key, { templateId: e.target.value })}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#dc2626] bg-[#fff3f3] border border-[#fecaca] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-[#1585ff] text-white text-sm font-medium rounded-lg hover:bg-[#0f6fd4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Starting…" : "Create & Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
