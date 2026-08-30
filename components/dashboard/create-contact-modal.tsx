"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { usePortalTarget } from "@/lib/hooks/use-portal-target";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const portalTarget = usePortalTarget();

  useEffect(() => {
    if (portalTarget) dialogRef.current?.showModal();
  }, [portalTarget]);

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

  if (!portalTarget) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="create-contact-title"
      className="fixed inset-0 m-auto z-50 w-full max-w-md h-fit bg-surface rounded-xl shadow-2xl border border-[var(--line)] flex flex-col max-h-[90vh] p-0 open:flex backdrop:bg-black/40"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] shrink-0">
          <h3 id="create-contact-title" className="text-sm font-semibold text-[var(--foreground)]">
            הוסף איש קשר ידני
          </h3>
          <button type="button" onClick={onClose} aria-label="סגור" className="text-[var(--faint)] hover:text-[var(--muted)] transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {TEXT_FIELDS.map(({ key, label, type, required }) => (
            <div key={key}>
              <label htmlFor={`cc-${key}`} className="flex items-center gap-1 text-[10px] font-mono text-[var(--faint)] uppercase tracking-widest mb-1">
                {label}
                {required && <span className="text-[var(--danger)]">*</span>}
              </label>
              <input
                id={`cc-${key}`}
                aria-label={label}
                type={type ?? "text"}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                dir={type === "url" || type === "email" || key === "phone" ? "ltr" : undefined}
                className={cn(
                  "w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] text-[var(--foreground)] placeholder:text-[var(--faint)]",
                  required && !form[key].trim() && error
                    ? "border-[var(--danger)]/30"
                    : "border-[var(--faint)]"
                )}
                placeholder={`הוסף ${label}…`}
              />
            </div>
          ))}

          <div>
            <label htmlFor="cc-seniority" className="block text-[10px] font-mono text-[var(--faint)] uppercase tracking-widest mb-1">
              Seniority
            </label>
            <select
              id="cc-seniority"
              value={form.seniority}
              onChange={(e) => setForm((prev) => ({ ...prev, seniority: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-[var(--faint)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] text-[var(--foreground)] bg-surface"
              dir="ltr"
            >
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--line)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            ביטול
          </button>
          <button
            type="submit"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg transition-colors",
              saving ? "opacity-60 cursor-not-allowed" : "hover:bg-[var(--accent-strong)]"
            )}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? "יוצר…" : "צור איש קשר"}
          </button>
        </div>
    </dialog>,
    portalTarget
  );
}
