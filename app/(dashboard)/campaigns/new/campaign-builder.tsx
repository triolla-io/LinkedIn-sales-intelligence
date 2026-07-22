"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Plus, Megaphone } from "lucide-react";
import { ui } from "@/lib/ui";
import { PageHeader } from "@/components/ui/page-header";

type Channel = "EMAIL" | "WHATSAPP" | "LINKEDIN";

type Template = {
  id: string;
  name: string;
};

type ContactList = {
  id: string;
  name: string;
};

type StepDraft = {
  localId: number;
  stepNumber: number;
  channel: Channel;
  templateId: string;
  dayOffset: number;
  sendHour: number;
  sendHourEnd: number | null;
  subject: string;
};

type Props = {
  templates: Template[];
  contactLists: ContactList[];
  initialName?: string;
  initialContactListId?: string | null;
  initialSteps?: StepDraft[];
  sequenceId?: string;
  isActive?: boolean;
};

const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  LINKEDIN: "LinkedIn",
};

const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

let nextLocalId = 1;
function newStep(stepNumber: number, dayOffset = 0): StepDraft {
  return {
    localId: nextLocalId++,
    stepNumber,
    channel: "EMAIL",
    templateId: "",
    dayOffset,
    sendHour: 9,
    sendHourEnd: 18,
    subject: "",
  };
}

export default function CampaignBuilder({
  templates,
  contactLists,
  initialName = "",
  initialContactListId = null,
  initialSteps,
  sequenceId,
  isActive = false,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [contactListId, setContactListId] = useState<string>(initialContactListId ?? "");
  const [steps, setSteps] = useState<StepDraft[]>(initialSteps ?? [newStep(1)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateStep(localId: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const maxOffset = steps.length > 0 ? steps[steps.length - 1].dayOffset : 0;
    setSteps((prev) => [...prev, newStep(prev.length + 1, maxOffset + 1)]);
  }

  function removeStep(localId: number) {
    setSteps((prev) => {
      const filtered = prev.filter((s) => s.localId !== localId);
      return filtered.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    });
  }

  function moveStep(localId: number, direction: "up" | "down") {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.localId === localId);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next.map((s, i) => ({ ...s, stepNumber: i + 1 }));
    });
  }

  function validate(): string | null {
    if (!name.trim()) return "נא להזין שם קמפיין";
    if (steps.length === 0) return "נא להוסיף לפחות שלב אחד";
    for (const step of steps) {
      if (!step.templateId) return `בחר תבנית לשלב ${step.stepNumber}`;
      if (step.channel === "EMAIL" && !step.subject.trim())
        return `נא להזין נושא לשלב ${step.stepNumber} (Email)`;
      if (step.sendHourEnd !== null && step.sendHourEnd <= step.sendHour)
        return `שעת סיום חייבת להיות אחרי שעת התחלה בשלב ${step.stepNumber}`;
    }
    let prevOffset = -1;
    for (const step of steps) {
      if (step.dayOffset < prevOffset)
        return `dayOffset בשלב ${step.stepNumber} חייב להיות גדול או שווה לשלב הקודם`;
      prevOffset = step.dayOffset;
    }
    return null;
  }

  function buildPayload() {
    return {
      name: name.trim(),
      contactListId: contactListId || null,
      steps: steps.map((s) => ({
        stepNumber: s.stepNumber,
        channel: s.channel,
        templateId: s.templateId,
        dayOffset: s.dayOffset,
        sendHour: s.sendHour,
        sendMinute: 0,
        sendHourEnd: s.sendHourEnd,
        subject: s.subject || null,
      })),
    };
  }

  async function save(andActivate: boolean) {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);

    try {
      let id = sequenceId;
      if (!id) {
        const res = await fetch("/api/sequences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בשמירה");
          return;
        }
        const json = await res.json();
        id = (json as { sequence: { id: string } }).sequence.id;
      } else {
        const res = await fetch(`/api/sequences/${id}/update`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload()),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בעדכון");
          return;
        }
      }

      if (andActivate) {
        const res = await fetch(`/api/sequences/${id}/start`, { method: "POST" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? "שגיאה בהפעלה");
          return;
        }
      }

      router.push(andActivate ? `/campaigns/${id}` : `/campaigns`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const templatesForChannel = (_channel: Channel) => templates;

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <PageHeader
        icon={Megaphone}
        title={sequenceId ? "עריכת קמפיין" : "קמפיין חדש"}
        subtitle="רצף הודעות אוטומטי — בחר ערוץ, תבנית ותזמון לכל שלב"
      />

      <div className="w-full max-w-2xl mx-auto px-6 pt-6 pb-10 space-y-5">
        {/* Campaign details */}
        <section className={`${ui.card} p-5 space-y-4`}>
          <h2 className={ui.sectionTitle}>פרטי הקמפיין</h2>
          <div>
            <label htmlFor="campaign-name" className={ui.label}>
              שם הקמפיין *
            </label>
            <input
              id="campaign-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמא: Outreach Q3"
              className={ui.input}
            />
          </div>
          <div>
            <label htmlFor="contact-list" className={ui.label}>
              רשימה מקושרת <span className="text-[#9b9895]">(אופציונלי)</span>
            </label>
            <select
              id="contact-list"
              value={contactListId}
              onChange={(e) => setContactListId(e.target.value)}
              className={ui.input}
            >
              <option value="">ללא רשימה</option>
              {contactLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#9b9895] mt-1">
              אנשי קשר שיתווספו לרשימה יירשמו אוטומטית לקמפיין
            </p>
          </div>
        </section>

        {/* Steps */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className={ui.sectionTitle}>שלבים</h2>
            <span className="text-xs text-[#9b9895]">
              {steps.length} {steps.length === 1 ? "שלב" : "שלבים"}
            </span>
          </div>

          {isActive && (
            <p className="text-xs text-[#b45309] bg-[#fffbeb] border border-[#fde68a] rounded-lg px-3 py-2">
              הקמפיין פעיל — לא ניתן לשנות שלבים. ניתן לשנות שם ורשימה בלבד.
            </p>
          )}

          {steps.map((step, idx) => {
            const channelTemplates = templatesForChannel(step.channel);
            const endValue = step.sendHourEnd ?? step.sendHour + 1;
            return (
              <div key={step.localId} className={`${ui.card} p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="grid place-items-center size-6 rounded-full bg-[#1585ff] text-white text-[11px] font-semibold tabular-nums">
                      {step.stepNumber}
                    </span>
                    <span className="text-sm font-medium text-[#1a1917]">שלב {step.stepNumber}</span>
                    <span className="text-[11px] text-[#6b6866] bg-[#f3f2ef] rounded-full px-2 py-0.5">
                      {step.dayOffset === 0 ? "יום ההתחלה" : `יום ${step.dayOffset}`}
                    </span>
                  </div>
                  {!isActive && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveStep(step.localId, "up")}
                        disabled={idx === 0}
                        aria-label="הזז שלב למעלה"
                        className="p-1 rounded hover:bg-[#f3f2ef] disabled:opacity-30 transition-colors"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(step.localId, "down")}
                        disabled={idx === steps.length - 1}
                        aria-label="הזז שלב למטה"
                        className="p-1 rounded hover:bg-[#f3f2ef] disabled:opacity-30 transition-colors"
                      >
                        <ChevronDown size={16} />
                      </button>
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(step.localId)}
                          aria-label="מחק שלב"
                          className="p-1 rounded hover:bg-[#fff3f3] text-[#dc2626] transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`step-channel-${step.localId}`} className={ui.label}>
                      ערוץ
                    </label>
                    <select
                      id={`step-channel-${step.localId}`}
                      value={step.channel}
                      disabled={isActive}
                      onChange={(e) =>
                        updateStep(step.localId, {
                          channel: e.target.value as Channel,
                          templateId: "",
                          subject: "",
                        })
                      }
                      className={ui.input}
                    >
                      {Object.entries(CHANNEL_LABELS).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`step-template-${step.localId}`} className={ui.label}>
                      תבנית *
                    </label>
                    <select
                      id={`step-template-${step.localId}`}
                      value={step.templateId}
                      disabled={isActive}
                      onChange={(e) => updateStep(step.localId, { templateId: e.target.value })}
                      className={ui.input}
                    >
                      <option value="">בחר תבנית</option>
                      {channelTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {step.channel === "EMAIL" && (
                  <div>
                    <label htmlFor={`step-subject-${step.localId}`} className={ui.label}>
                      נושא המייל *
                    </label>
                    <input
                      id={`step-subject-${step.localId}`}
                      aria-label="נושא המייל"
                      type="text"
                      value={step.subject}
                      disabled={isActive}
                      onChange={(e) => updateStep(step.localId, { subject: e.target.value })}
                      placeholder="נושא"
                      className={ui.input}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`step-day-offset-${step.localId}`} className={ui.label}>
                      אחרי כמה ימים
                    </label>
                    <input
                      id={`step-day-offset-${step.localId}`}
                      aria-label="אחרי כמה ימים"
                      type="number"
                      min={0}
                      value={step.dayOffset}
                      disabled={isActive}
                      onChange={(e) =>
                        updateStep(step.localId, { dayOffset: parseInt(e.target.value) || 0 })
                      }
                      className={ui.input}
                    />
                  </div>
                  <div>
                    <span className={ui.label}>שעות שליחה</span>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="שעת התחלה"
                        value={step.sendHour}
                        disabled={isActive}
                        onChange={(e) => {
                          const start = Number(e.target.value);
                          updateStep(step.localId, {
                            sendHour: start,
                            sendHourEnd: Math.max(endValue, start + 1),
                          });
                        }}
                        className={ui.input}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {fmtHour(h)}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs text-[#9b9895]">—</span>
                      <select
                        aria-label="שעת סיום"
                        value={endValue}
                        disabled={isActive}
                        onChange={(e) =>
                          updateStep(step.localId, { sendHourEnd: Number(e.target.value) })
                        }
                        className={ui.input}
                      >
                        {Array.from({ length: 24 - step.sendHour }, (_, i) => step.sendHour + 1 + i).map(
                          (h) => (
                            <option key={h} value={h}>
                              {fmtHour(h)}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {!isActive && (
            <button
              type="button"
              onClick={addStep}
              className="w-full flex items-center justify-center gap-1.5 py-3 text-sm font-medium text-[#6b6866] bg-white/50 border border-dashed border-[#d9d5cd] rounded-2xl hover:border-[#1585ff]/50 hover:text-[#1585ff] hover:bg-[#1585ff]/5 transition-colors"
            >
              <Plus size={16} />
              הוסף שלב
            </button>
          )}
        </div>

        {error && (
          <p className="text-sm text-[#dc2626] bg-[#fff3f3] border border-[#fde2e2] rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button type="button" onClick={() => router.back()} disabled={saving} className={ui.btnGhost}>
            ביטול
          </button>
          <button type="button" onClick={() => save(false)} disabled={saving} className={ui.btnSecondary}>
            {saving ? "שומר..." : "שמור כטיוטה"}
          </button>
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving || (!!sequenceId && isActive)}
            className={ui.btnPrimary}
          >
            {saving ? "מפעיל..." : sequenceId && !isActive ? "עדכן והפעל" : "שמור והפעל"}
          </button>
        </div>
      </div>
    </div>
  );
}
