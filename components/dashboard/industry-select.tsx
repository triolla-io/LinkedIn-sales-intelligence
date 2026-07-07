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
    return matches.filter((i) => !value.includes(i.id));
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
      <label htmlFor="run-industries" className="block text-xs font-medium text-[#6b6866] mb-1">
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
        className="w-full bg-[#f8f7f5] border border-[#e5e3df] rounded-md px-3 py-2 text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/60 focus:bg-white transition-colors"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-[#e5e3df] rounded-md shadow-md">
          {results.map((industry) => (
            <li key={industry.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(industry.id)}
                className="w-full text-left px-3 py-2 text-sm text-[#111110] hover:bg-[#f3f2ef] transition-colors"
              >
                {industry.label}
                {industry.path.includes(" > ") && (
                  <span className="block text-xs text-[#9b9895]">{industry.path}</span>
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
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[#e6f4ff] text-[#1585ff]"
              >
                {label}
                <button
                  type="button"
                  onClick={() => remove(id)}
                  aria-label={`הסר ${label}`}
                  className="hover:text-[#0a70e0] transition-colors"
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
