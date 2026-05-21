"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";

interface EditContactModalProps {
  contact: Contact;
  onClose: () => void;
  onSaved: (updated: Contact) => void;
}

type EditableField = "email" | "phone" | "currentTitle" | "currentCompany" | "location" | "headline";

const FIELDS: { key: EditableField; label: string; type?: string }[] = [
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "currentTitle", label: "Title" },
  { key: "currentCompany", label: "Company" },
  { key: "location", label: "Location" },
  { key: "headline", label: "Headline" },
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

  const initialValues = useRef<Record<EditableField, string>>(
    Object.fromEntries(
      FIELDS.map(({ key }) => [key, (contact[key] as string | null | undefined) ?? ""])
    ) as Record<EditableField, string>
  );

  const isDirty = FIELDS.some(({ key }) => form[key] !== initialValues.current[key]);

  const manualSet = new Set(contact.manualFields ?? []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      if (!res.ok) throw new Error("Save failed");
      const updated = await res.json();
      onSaved({ ...contact, ...updated });
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-contact-dialog-title"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-xl shadow-2xl border border-[#e5e3df]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e3df]">
          <h3 id="edit-contact-dialog-title" className="text-sm font-semibold text-[#111110]">Edit Contact</h3>
          <button onClick={onClose} aria-label="Close" className="text-[#9b9895] hover:text-[#6b6866] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {FIELDS.map(({ key, label, type }) => (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1">
                <label htmlFor={key} className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  {label}
                </label>
                {manualSet.has(key) && (
                  <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                    manual
                  </span>
                )}
              </div>
              <input
                id={key}
                type={type ?? "text"}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-[#d1cfcb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1585ff]/30 focus:border-[#1585ff] text-[#111110] placeholder:text-[#c4c2be]"
                placeholder={`Add ${label.toLowerCase()}...`}
              />
            </div>
          ))}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#e5e3df]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#6b6866] hover:text-[#111110] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn(
              "px-4 py-2 text-sm font-medium text-white bg-[#1585ff] rounded-lg transition-colors",
              saving || !isDirty ? "opacity-60 cursor-not-allowed" : "hover:bg-[#0a70e0]"
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
