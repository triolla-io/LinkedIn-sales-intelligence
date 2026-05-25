"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";

interface CreateContactModalProps {
  onClose: () => void;
  onCreated: (contact: Contact) => void;
}

const SENIORITY_OPTIONS = [
  { value: "", label: "— ללא —" },
  { value: "C_LEVEL", label: "C-Level" },
  { value: "VP", label: "VP" },
  { value: "DIRECTOR", label: "Director" },
  { value: "MANAGER", label: "Manager" },
  { value: "IC", label: "IC" },
  { value: "OTHER", label: "Other" },
];

const TEXT_FIELDS: { key: string; label: string; type?: string; required?: boolean }[] = [
  { key: "fullName",        label: "שם מלא",     required: true },
  { key: "hebrewFirstName", label: "שם פרטי עברי" },
  { key: "currentTitle",    label: "תפקיד" },
  { key: "currentCompany",  label: "חברה" },
  { key: "location",        label: "מיקום" },
  { key: "headline",        label: "כותרת" },
  { key: "email",           label: "אימייל",      type: "email" },
  { key: "phone",           label: "טלפון",       type: "tel" },
  { key: "linkedinUrl",     label: "LinkedIn URL", type: "url" },
];

const EMPTY: Record<string, string> = Object.fromEntries(
  TEXT_FIELDS.map((f) => [f.key, ""])
);

export default function CreateContactModal({ onClose, onCreated }: CreateContactModalProps) {
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY, seniority: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    if (!form.fullName.trim()) {
      setError("שם מלא הוא שדה חובה.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {};
      for (const { key } of TEXT_FIELDS) {
        body[key] = form[key].trim() || null;
      }
      if (form.seniority) body.seniority = form.seniority;

      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "יצירה נכשלה");
      }
      const data = await res.json();
      onCreated({
        ...data.contact,
        lastSyncedAt: data.contact.lastSyncedAt ?? new Date().toISOString(),
      } as Contact);
    } catch (e) {
      setError((e as Error).message || "אירעה שגיאה. נסה שוב.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contact-title"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-xl shadow-2xl border border-[#e5e3df] flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e3df] shrink-0">
          <h3 id="create-contact-title" className="text-sm font-semibold text-[#111110]">
            הוסף איש קשר ידני
          </h3>
          <button onClick={onClose} aria-label="סגור" className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {TEXT_FIELDS.map(({ key, label, type, required }) => (
            <div key={key}>
              <label htmlFor={`cc-${key}`} className="flex items-center gap-1 text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-1">
                {label}
                {required && <span className="text-red-400">*</span>}
              </label>
              <input
                id={`cc-${key}`}
                type={type ?? "text"}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                dir={type === "url" || type === "email" || key === "phone" ? "ltr" : undefined}
                className={cn(
                  "w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] text-[#111110] placeholder:text-[#c4c2be]",
                  required && !form[key].trim() && error
                    ? "border-red-300"
                    : "border-[#d1cfcb]"
                )}
                placeholder={`הוסף ${label}…`}
              />
            </div>
          ))}

          <div>
            <label htmlFor="cc-seniority" className="block text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-1">
              Seniority
            </label>
            <select
              id="cc-seniority"
              value={form.seniority}
              onChange={(e) => setForm((prev) => ({ ...prev, seniority: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-[#d1cfcb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] text-[#111110] bg-white"
              dir="ltr"
            >
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e5e3df] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1585ff] rounded-lg transition-colors",
              saving ? "opacity-60 cursor-not-allowed" : "hover:bg-[#0a70e0]"
            )}
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "יוצר…" : "צור איש קשר"}
          </button>
        </div>
      </div>
    </>
  );
}
