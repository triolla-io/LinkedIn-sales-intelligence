"use client";

import { useState, useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePortalTarget } from "@/lib/hooks/use-portal-target";
import type { Contact } from "./contact-table";

interface EditContactModalProps {
  contact: Contact;
  onClose: () => void;
  onSaved: (updated: Contact) => void;
}

type EditableField = "email" | "phone" | "currentTitle" | "currentCompany" | "location" | "headline" | "linkedinUrl";

const FIELDS: { key: EditableField; label: string; type?: string; dir?: "ltr" }[] = [
  { key: "email",          label: "אימייל",      type: "email", dir: "ltr" },
  { key: "phone",          label: "טלפון",       type: "tel",   dir: "ltr" },
  { key: "currentTitle",   label: "תפקיד" },
  { key: "currentCompany", label: "חברה" },
  { key: "location",       label: "מיקום" },
  { key: "headline",       label: "כותרת" },
  { key: "linkedinUrl",    label: "LinkedIn URL", type: "url", dir: "ltr" },
];

export default function EditContactModal({ contact, onClose, onSaved }: EditContactModalProps) {
  const [form, setForm] = useState<Record<EditableField, string>>(() => {
    const initial = {} as Record<EditableField, string>;
    for (const { key } of FIELDS) {
      initial[key] = (contact[key] as string | null | undefined) ?? "";
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const portalTarget = usePortalTarget();

  const [initialValues] = useState<Record<EditableField, string>>(
    () =>
      Object.fromEntries(
        FIELDS.map(({ key }) => [key, (contact[key] as string | null | undefined) ?? ""])
      ) as Record<EditableField, string>
  );

  const isDirty = FIELDS.some(({ key }) => form[key] !== initialValues[key]);
  const manualSet = new Set(contact.manualFields ?? []);

  const onEscape = useEffectEvent(() => onClose());
  useEffect(() => {
    if (portalTarget) firstInputRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onEscape(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [portalTarget]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {};
      for (const { key } of FIELDS) {
        body[key] = form[key].trim() === "" ? null : form[key].trim();
      }
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error ?? errData?.detail ?? `HTTP ${res.status}`);
      }
      const updated = await res.json();
      onSaved({ ...contact, ...updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[EditContactModal] save failed:", msg);
      setError(`שמירה נכשלה: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (!portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      aria-hidden="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-[#e5e3df] mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e3df]">
          <h3 className="text-sm font-semibold text-[#111110]">ערוך איש קשר</h3>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {FIELDS.map(({ key, label, type, dir }, i) => (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1">
                <label htmlFor={`edit-${key}`} className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  {label}
                </label>
                {manualSet.has(key) && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                    ידני
                  </span>
                )}
              </div>
              <input
                ref={i === 0 ? firstInputRef : undefined}
                id={`edit-${key}`}
                aria-label={label}
                type={type ?? "text"}
                dir={dir}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#d1cfcb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] text-[#111110] placeholder:text-[#c4c2be]"
                placeholder={`הוסף ${label}...`}
              />
            </div>
          ))}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e5e3df]">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors">
            ביטול
          </button>
          <button
            type="submit"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn(
              "px-4 py-2 text-sm font-medium text-white bg-[#1585ff] rounded-lg transition-colors",
              saving || !isDirty ? "opacity-60 cursor-not-allowed" : "hover:bg-[#0a70e0]"
            )}
          >
            {saving ? "שומר…" : "שמור"}
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
