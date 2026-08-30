"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { INDUSTRY_BY_ID } from "@/lib/prospecting/industries";
import { searchIndustries } from "@/lib/prospecting/search-industries";

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
};

// Shown before the user types, mirroring the defaults LinkedIn's own Industries
// facet suggests (observed live 2026-07-07). Search covers the full taxonomy.
const SUGGESTED_INDUSTRY_IDS = [
  "1594", // Technology, Information and Media
  "6", // Technology, Information and Internet
  "1810", // Professional Services
  "4", // Software Development
  "25", // Manufacturing
  "11", // Business Consulting and Services
];

export function IndustrySelect({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const matches = query.trim()
      ? searchIndustries(query, 8 + value.length)
      : SUGGESTED_INDUSTRY_IDS.map((id) => INDUSTRY_BY_ID.get(id)).filter(
          (i): i is NonNullable<typeof i> => i !== undefined
        );
    const selected = new Set(value);
    return matches.filter((i) => !selected.has(i.id));
  }, [query, value]);

  function add(id: string) {
    onChange([...value, id]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
  }

  return (
    <div className="relative">
      <label htmlFor="run-industries" className="block text-xs font-medium text-[var(--muted)] mb-1">
        Industries (אופציונלי — ריק = כל התעשיות)
      </label>
      <input
        id="run-industries"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="e.g. Software Development"
        autoComplete="off"
        className="w-full bg-[var(--surface-secondary)] border border-[var(--line)] rounded-md px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--faint)] focus:outline-none focus:border-[var(--accent)]/60 focus:bg-surface transition-colors"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-surface border border-[var(--line)] rounded-md shadow-md">
          {results.map((industry) => (
            <li key={industry.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(industry.id)}
                className="w-full text-left px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface-secondary)] transition-colors"
              >
                {industry.label}
                {industry.path.includes(" > ") && (
                  <span className="block text-xs text-[var(--faint)]">{industry.path}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map((id) => {
            const label = INDUSTRY_BY_ID.get(id)?.label ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent-soft)] text-[var(--accent)]"
              >
                {label}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label={`הסר ${label}`}
                  className="hover:text-[var(--accent-strong)] transition-colors"
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
