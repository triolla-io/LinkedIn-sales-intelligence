"use client";

import { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type Filters = {
  seniority: string[];
  function: string[];
  q: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
};

type QuickFilter = {
  label: string;
  seniority?: string[];
  function?: string[];
};

const QUICK_FILTERS: QuickFilter[] = [
  { label: "CEO", seniority: ["C_LEVEL"] },
  { label: "CTO", seniority: ["C_LEVEL"], function: ["ENGINEERING"] },
  { label: "VP", seniority: ["VP"] },
  { label: "Director", seniority: ["DIRECTOR"] },
  { label: "HR / גיוס", function: ["HR"] },
  { label: "הנדסה", function: ["ENGINEERING"] },
  { label: "מכירות", function: ["SALES"] },
  { label: "שיווק", function: ["MARKETING"] },
  { label: "מוצר", function: ["PRODUCT"] },
];

function isQuickActive(f: Filters, q: QuickFilter): boolean {
  const senMatch = !q.seniority || q.seniority.every((s) => f.seniority.includes(s));
  const fnMatch = !q.function || q.function.every((fn) => f.function.includes(fn));
  return senMatch && fnMatch && (!!q.seniority || !!q.function);
}

function applyQuick(f: Filters, q: QuickFilter): Filters {
  if (isQuickActive(f, q)) {
    // Deselect — remove only the values this quick filter added
    return {
      ...f,
      seniority: f.seniority.filter((s) => !q.seniority?.includes(s)),
      function: f.function.filter((fn) => !q.function?.includes(fn)),
    };
  }
  return {
    ...f,
    seniority: [...new Set([...f.seniority, ...(q.seniority ?? [])])],
    function: [...new Set([...f.function, ...(q.function ?? [])])],
  };
}

interface FilterBarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const hasFilters =
    filters.q ||
    filters.seniority.length > 0 ||
    filters.function.length > 0 ||
    filters.hasEmail ||
    filters.hasPhone;

  function clearAll() {
    onChange({ seniority: [], function: [], q: "", hasEmail: undefined, hasPhone: undefined });
  }

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-2">
      {/* Quick-filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {QUICK_FILTERS.map((q) => {
          const active = isQuickActive(filters, q);
          return (
            <button
              key={q.label}
              onClick={() => onChange(applyQuick(filters, q))}
              className={cn(
                "px-3 py-1 rounded-full text-sm font-medium border transition-colors",
                active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
              )}
            >
              {q.label}
            </button>
          );
        })}

        {/* Has Email */}
        <button
          onClick={() => onChange({ ...filters, hasEmail: filters.hasEmail ? undefined : true })}
          className={cn(
            "px-3 py-1 rounded-full text-sm font-medium border transition-colors",
            filters.hasEmail
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-600"
          )}
        >
          יש אימייל
        </button>

        {/* Has Phone */}
        <button
          onClick={() => onChange({ ...filters, hasPhone: filters.hasPhone ? undefined : true })}
          className={cn(
            "px-3 py-1 rounded-full text-sm font-medium border transition-colors",
            filters.hasPhone
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-600 border-gray-300 hover:border-green-400 hover:text-green-600"
          )}
        >
          יש טלפון
        </button>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-3 py-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-3 h-3" />
            נקה
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          placeholder='חיפוש לפי שם, חברה, תפקיד...'
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {filters.q && (
          <button
            onClick={() => onChange({ ...filters, q: "" })}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>
    </div>
  );
}
