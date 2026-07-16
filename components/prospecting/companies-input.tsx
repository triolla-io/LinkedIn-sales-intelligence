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
        <label htmlFor="companies-text" className="text-sm text-[#6b6866]">
          חברות — שם או קישור LinkedIn, חברה אחת בכל שורה
        </label>
        <span className="text-xs text-[#9b9895] tabular-nums">
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
        className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] font-mono focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors resize-y"
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
        <div className="flex items-center gap-2 bg-[#e6f4ff] border border-[#1585ff]/20 rounded-md px-3 py-2 text-sm text-[#111110] animate-in fade-in zoom-in-95 duration-200">
          <FileSpreadsheet className="w-4 h-4 text-[#1585ff] shrink-0" />
          <span className="truncate flex-1">{file.name}</span>
          <button
            type="button"
            aria-label="הסר קובץ"
            disabled={disabled}
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="p-2 -m-1 rounded hover:bg-[#1585ff]/10 transition-colors"
          >
            <X className="w-4 h-4 text-[#6b6866]" />
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
              ? "border-[#1585ff] bg-[#1585ff]/5 text-[#1585ff]"
              : "border-[#d4d0cc] bg-white text-[#6b6866] hover:border-[#9b9895] hover:bg-[#f8f7f5]",
          )}
        >
          <Upload className="w-4 h-4" />
          או גרור לכאן קובץ CSV/XLSX מהגיליון
        </button>
      )}
    </div>
  );
}
