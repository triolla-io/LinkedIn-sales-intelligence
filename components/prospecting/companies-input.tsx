"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { parseCompanyLines } from "@/lib/prospecting/company-lines";
import { cn } from "@/lib/cn";

type Props = {
  value: string;
  onChange: (v: string) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  disabled?: boolean;
};

/** Manual companies textarea + compact CSV/XLSX drop zone (create form + add modal). */
export function CompaniesInput({
  value,
  onChange,
  file,
  onFileChange,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const count = parseCompanyLines(value).length;

  return (
    <div className="grid gap-2" dir="rtl">
      <div className="flex items-center justify-between">
        <label htmlFor="companies-text" className="text-xs font-medium text-[var(--muted)]">
          חברות — שם או קישור LinkedIn, חברה אחת בכל שורה
        </label>
        <span className="text-xs text-[var(--faint)] tabular-nums">
          {count} חברות
        </span>
      </div>
      <textarea
        id="companies-text"
        dir="ltr"
        rows={4}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"Acme Corp\nhttps://www.linkedin.com/company/globex"}
        className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] font-mono focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors resize-y"
      />

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        aria-label="העלאת קובץ חברות (CSV או XLSX)"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center gap-2 bg-[var(--accent-soft)] border border-[var(--accent)]/20 rounded-md px-3 py-2 text-sm text-[var(--foreground)] animate-in fade-in zoom-in-95 duration-200">
          <FileSpreadsheet className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="truncate flex-1">{file.name}</span>
          <button
            type="button"
            aria-label="הסר קובץ"
            disabled={disabled}
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="p-2 -m-1 rounded hover:bg-[var(--accent)]/10 transition-colors"
          >
            <X className="w-4 h-4 text-[var(--muted)]" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFileChange(f);
          }}
          onClick={() => inputRef.current?.click()}
          aria-label="גרור קובץ חברות לכאן או לחץ לעיון"
          className={cn(
            "rounded-md border-2 border-dashed px-4 py-3 flex items-center justify-center gap-2 cursor-pointer transition-colors w-full text-sm",
            dragging
              ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]"
              : "border-[var(--faint)] bg-surface text-[var(--muted)] hover:border-[var(--faint)] hover:bg-[var(--surface-secondary)]",
          )}
        >
          <Upload className="w-4 h-4" />
          או גרור לכאן קובץ CSV/XLSX מהגיליון
        </button>
      )}
    </div>
  );
}
