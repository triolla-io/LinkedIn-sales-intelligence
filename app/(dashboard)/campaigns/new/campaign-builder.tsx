"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";

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
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900">
        {sequenceId ? "עריכת קמפיין" : "קמפיין חדש"}
      </h1>

      <section className="space-y-4">
        <div>
          <label htmlFor="campaign-name" className="block text-sm font-medium text-gray-700 mb-1">שם הקמפיין *</label>
          <input
            id="campaign-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמא: Outreach Q3"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="contact-list" className="block text-sm font-medium text-gray-700 mb-1">
            רשימה מקושרת <span className="text-gray-400">(אופציונלי)</span>
          </label>
          <select
            id="contact-list"
            value={contactListId}
            onChange={(e) => setContactListId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">ללא רשימה</option>
            {contactLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            אנשי קשר שיתווספו לרשימה יירשמו אוטומטית לקמפיין
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-800">שלבים</h2>

        {isActive && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            הקמפיין פעיל — לא ניתן לשנות שלבים. ניתן לשנות שם ורשימה בלבד.
          </p>
        )}

        {steps.map((step, idx) => {
          const channelTemplates = templatesForChannel(step.channel);
          return (
            <div
              key={step.localId}
              className="border border-gray-200 rounded-xl p-4 space-y-3 bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">שלב {step.stepNumber}</span>
                {!isActive && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveStep(step.localId, "up")}
                      disabled={idx === 0}
                      aria-label="הזז שלב למעלה"
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(step.localId, "down")}
                      disabled={idx === steps.length - 1}
                      aria-label="הזז שלב למטה"
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"
                    >
                      <ChevronDown size={16} />
                    </button>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(step.localId)}
                        aria-label="מחק שלב"
                        className="p-1 rounded hover:bg-red-50 text-red-500"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`step-channel-${step.localId}`} className="block text-xs text-gray-500 mb-1">ערוץ</label>
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
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(CHANNEL_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`step-template-${step.localId}`} className="block text-xs text-gray-500 mb-1">תבנית *</label>
                  <select
                    id={`step-template-${step.localId}`}
                    value={step.templateId}
                    disabled={isActive}
                    onChange={(e) => updateStep(step.localId, { templateId: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  <label htmlFor={`step-subject-${step.localId}`} className="block text-xs text-gray-500 mb-1">נושא המייל *</label>
                  <input
                    id={`step-subject-${step.localId}`}
                    aria-label="נושא המייל"
                    type="text"
                    value={step.subject}
                    disabled={isActive}
                    onChange={(e) => updateStep(step.localId, { subject: e.target.value })}
                    placeholder="נושא"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor={`step-day-offset-${step.localId}`} className="block text-xs text-gray-500 mb-1">אחרי כמה ימים</label>
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
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor={`step-send-hour-${step.localId}`} className="block text-xs text-gray-500 mb-1">שעת התחלה</label>
                  <input
                    id={`step-send-hour-${step.localId}`}
                    aria-label="שעת התחלה"
                    type="number"
                    min={0}
                    max={23}
                    value={step.sendHour}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, { sendHour: parseInt(e.target.value) || 0 })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor={`step-send-hour-end-${step.localId}`} className="block text-xs text-gray-500 mb-1">שעת סיום</label>
                  <input
                    id={`step-send-hour-end-${step.localId}`}
                    aria-label="שעת סיום"
                    type="number"
                    min={0}
                    max={23}
                    value={step.sendHourEnd ?? ""}
                    disabled={isActive}
                    onChange={(e) =>
                      updateStep(step.localId, {
                        sendHourEnd: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {!isActive && (
          <button
            type="button"
            onClick={addStep}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Plus size={16} />
            הוסף שלב
          </button>
        )}
      </section>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => save(false)}
          disabled={saving}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "שומר..." : "שמור כטיוטה"}
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={saving || (!!sequenceId && isActive)}
          className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "מפעיל..." : sequenceId && !isActive ? "עדכן והפעל" : "שמור והפעל"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={saving}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}
