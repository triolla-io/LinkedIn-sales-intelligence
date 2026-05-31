"use client";

import { useState } from "react";
import { Search, X, ChevronDown, ChevronUp, BookMarked, ChevronLeft, ChevronRight } from "lucide-react";
import useSWR from "swr";
import { cn } from "@/lib/cn";
import { useCollapsed } from "@/lib/hooks/use-collapsed";
import { type Filters, DEFAULT_FILTERS } from "./filter-types";

// Re-export so existing consumers can still import from this file
export type { Filters };
export { DEFAULT_FILTERS };

const COMPANY_SIZE_BUCKETS = [
  { label: "1 – 10", value: "1-10" },
  { label: "11 – 50", value: "11-50" },
  { label: "51 – 200", value: "51-200" },
  { label: "201 – 500", value: "201-500" },
  { label: "501 – 1,000", value: "501-1000" },
  { label: "1,001 – 5,000", value: "1001-5000" },
  { label: "5,001+", value: "5001+" },
];

type PillDef = { label: string; filterKey: "titleSearch" | "function"; value: string };

const ROLE_PILLS: PillDef[] = [
  { label: "CEO", filterKey: "titleSearch", value: "CEO" },
  { label: "COO", filterKey: "titleSearch", value: "COO" },
  { label: "CFO", filterKey: "titleSearch", value: "CFO" },
  { label: "CTO", filterKey: "titleSearch", value: "CTO" },
  { label: "Founder", filterKey: "titleSearch", value: "Founder" },
  { label: "HR", filterKey: "function", value: "HR" },
  { label: "CMO", filterKey: "titleSearch", value: "CMO" },
  { label: "CPO", filterKey: "titleSearch", value: "CPO" },
  { label: "Sales", filterKey: "function", value: "SALES" },
  { label: "PM", filterKey: "titleSearch", value: "Product Manager" },
];

const INDUSTRY_PILLS = [
  "SaaS", "Fintech", "Healthcare", "Real Estate",
  "E-commerce", "Education", "Media", "Manufacturing",
];


function Section({
  title,
  children,
  defaultOpen = true,
  activeCount = 0,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#e5e3df] last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between w-full px-4 py-2.5 text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest hover:text-[#6b6866] transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {activeCount > 0 && (
            <span className="px-1 py-0.5 rounded bg-[#1585ff]/10 text-[#1585ff] text-[9px] font-mono">
              {activeCount}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#1585ff]/10 text-[#1585ff] border border-[#1585ff]/20">
      {label}
      <button type="button" onClick={onRemove} aria-label={`הסר ${label}`} className="hover:text-[#0a65c7] transition-colors">
        <X className="size-2.5" />
      </button>
    </span>
  );
}

interface FilterSidebarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
}

function countActiveFilters(filters: Filters): number {
  return (
    (filters.q ? 1 : 0) +
    filters.seniority.length +
    filters.function.length +
    filters.titleSearch.length +
    filters.industry.length +
    filters.companySizeBuckets.length +
    (filters.hasEmail ? 1 : 0) +
    (filters.hasPhone ? 1 : 0) +
    (filters.listId ? 1 : 0)
  );
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function FilterSidebar({ filters, onChange }: FilterSidebarProps) {
  const [customTitle, setCustomTitle] = useState("");
  const { data: listsData } = useSWR("/api/lists", fetcher);
  const lists: { id: string; name: string; memberCount: number }[] = listsData?.lists ?? [];
  const [collapsed, toggleCollapsed] = useCollapsed("filter-sidebar-collapsed");

  const hasFilters =
    filters.q ||
    filters.seniority.length ||
    filters.function.length ||
    filters.titleSearch.length ||
    filters.companySizeBuckets.length ||
    filters.industry.length ||
    filters.hasEmail ||
    filters.hasPhone ||
    filters.listId;
  const activeCount = countActiveFilters(filters);

  function toggle<K extends keyof Filters>(key: K, value: string) {
    const arr = filters[key] as string[];
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    onChange({ ...filters, [key]: next });
  }

  function addCustomTitle(e: React.KeyboardEvent) {
    if (e.key === "Enter" && customTitle.trim()) {
      const val = customTitle.trim();
      if (!filters.titleSearch.includes(val)) {
        onChange({ ...filters, titleSearch: [...filters.titleSearch, val] });
      }
      setCustomTitle("");
    }
  }

  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center justify-start pt-4 gap-3 h-full bg-white border-l border-[#e5e3df] transition-[width] duration-200 ease-in-out"
        style={{ width: 32 }}
      >
        {activeCount > 0 && (
          <span className="size-5 rounded-full bg-[#1585ff] text-white text-[9px] font-mono font-semibold flex items-center justify-center">
            {activeCount > 9 ? "9+" : activeCount}
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title="הרחב פילטרים"
          aria-label="הרחב פילטרים"
          className="flex items-center justify-center size-6 rounded text-[#9b9895] hover:text-[#6b6866] hover:bg-[#f3f2ef] transition-colors"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-white border-l border-[#e5e3df] transition-[width] duration-200 ease-in-out"
      style={{ width: 224 }}
    >
      {/* Search */}
      <div className="p-4 border-b border-[#e5e3df]">
        <div className="flex items-center gap-2 mb-2">
          <span className="flex-1 text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest">סינון</span>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="כווץ פילטרים"
            aria-label="כווץ פילטרים"
            className="flex items-center justify-center size-5 rounded text-[#c8c5c2] hover:text-[#6b6866] hover:bg-[#f3f2ef] transition-colors"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        </div>
        <div className="relative">
          {filters.q ? (
            <button
              type="button"
              aria-label="נקה חיפוש"
              onClick={() => onChange({ ...filters, q: "" })}
              className="absolute left-3 top-1/2 -translate-y-1/2"
            >
              <X className="size-3.5 text-[#9b9895] hover:text-[#6b6866]" />
            </button>
          ) : (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#9b9895]" />
          )}
          <input
            type="text"
            aria-label="חיפוש אנשי קשר"
            placeholder="חיפוש אנשי קשר…"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            className="w-full pl-9 pr-3 py-2 bg-[#f8f7f5] border border-[#e5e3df] rounded-md text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Lists */}
        {lists.length > 0 && (
          <div className="border-b border-[#e5e3df] px-4 py-3">
            <p className="text-[10px] font-mono font-semibold text-[#9b9895] uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <BookMarked className="size-3" />
              רשימות
            </p>
            <div className="space-y-0.5">
              {lists.map((list) => (
                <button
                  type="button"
                  key={list.id}
                  onClick={() =>
                    onChange({
                      ...filters,
                      listId: filters.listId === list.id ? undefined : list.id,
                    })
                  }
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors text-left",
                    filters.listId === list.id
                      ? "bg-[#1585ff]/10 text-[#1585ff] font-medium"
                      : "text-[#6b6866] hover:bg-[#f3f2ef] hover:text-[#111110]"
                  )}
                >
                  <span className="truncate">{list.name}</span>
                  <span className="shrink-0 text-[#9b9895] font-mono text-[10px]">{list.memberCount}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Company Size */}
        <Section title="גודל חברה" activeCount={filters.companySizeBuckets.length}>
          <div className="space-y-1.5">
            {COMPANY_SIZE_BUCKETS.map((b) => {
              const active = filters.companySizeBuckets.includes(b.value);
              return (
                <label key={b.value} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggle("companySizeBuckets", b.value)}
                    className="sr-only"
                  />
                  <div
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 rounded border flex items-center justify-center shrink-0 transition-all",
                      active
                        ? "bg-[#1585ff] border-[#1585ff]"
                        : "bg-white border-[#d4d0cc] group-hover:border-[#9b9895]"
                    )}
                  >
                    {active && <div className="w-2 h-1.5 border-b-2 border-l-2 border-white -mt-0.5 -rotate-45" />}
                  </div>
                  <span className={cn(
                    "text-xs transition-colors",
                    active ? "text-[#1585ff]" : "text-[#6b6866] group-hover:text-[#111110]"
                  )}>
                    {b.label}
                  </span>
                </label>
              );
            })}
          </div>
        </Section>

        {/* Role / Title */}
        <Section title="תפקיד / פונקציה" activeCount={filters.titleSearch.length + filters.function.length}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_PILLS.map((pill) => {
              const active = (filters[pill.filterKey] as string[]).includes(pill.value);
              return (
                <button
                  type="button"
                  key={pill.label}
                  onClick={() => toggle(pill.filterKey, pill.value)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                    active
                      ? "bg-[#1585ff]/10 text-[#1585ff] border-[#1585ff]/30"
                      : "bg-white text-[#6b6866] border-[#d4d0cc] hover:border-[#9b9895] hover:text-[#111110]"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            aria-label="הוסף תפקיד"
            placeholder="הוסף תפקיד…"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            onKeyDown={addCustomTitle}
            className="w-full px-3 py-1.5 bg-[#f8f7f5] border border-[#e5e3df] rounded-md text-xs text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {filters.titleSearch.flatMap((t) =>
              ROLE_PILLS.some((p) => p.value === t)
                ? []
                : [<ActivePill key={t} label={t} onRemove={() => toggle("titleSearch", t)} />]
            )}
          </div>
        </Section>

        {/* Industry */}
        <Section title="ענף" defaultOpen={false} activeCount={filters.industry.length}>
          <div className="flex flex-wrap gap-1.5">
            {INDUSTRY_PILLS.map((industry) => (
              <button
                type="button"
                key={industry}
                onClick={() => toggle("industry", industry)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                  filters.industry.includes(industry)
                    ? "bg-[#1585ff]/10 text-[#1585ff] border-[#1585ff]/30"
                    : "bg-white text-[#6b6866] border-[#d4d0cc] hover:border-[#9b9895] hover:text-[#111110]"
                )}
              >
                {industry}
              </button>
            ))}
          </div>
        </Section>

        {/* Contact info */}
        <Section title="פרטי קשר" activeCount={(filters.hasEmail ? 1 : 0) + (filters.hasPhone ? 1 : 0)}>
          <div className="space-y-1.5">
            {[
              { key: "hasEmail" as const, label: "יש אימייל" },
              { key: "hasPhone" as const, label: "יש טלפון" },
            ].map(({ key, label }) => {
              const active = !!filters[key];
              return (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onChange({ ...filters, [key]: active ? undefined : true })}
                    className="sr-only"
                  />
                  <div
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 rounded border flex items-center justify-center shrink-0 transition-all",
                      active
                        ? "bg-[#1585ff] border-[#1585ff]"
                        : "bg-white border-[#d4d0cc] group-hover:border-[#9b9895]"
                    )}
                  >
                    {active && <div className="w-2 h-1.5 border-b-2 border-l-2 border-white -mt-0.5 -rotate-45" />}
                  </div>
                  <span className={cn(
                    "text-xs transition-colors",
                    active ? "text-[#1585ff]" : "text-[#6b6866] group-hover:text-[#111110]"
                  )}>
                    {label}
                  </span>
                </label>
              );
            })}
          </div>
        </Section>
      </div>

      {/* Clear all */}
      {hasFilters && (
        <div className="p-3 border-t border-[#e5e3df]">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono text-[#6b6866] hover:text-[#111110] border border-[#e5e3df] hover:border-[#9b9895] rounded-md transition-colors"
          >
            <X className="size-3" />
            נקה הכל
          </button>
        </div>
      )}
    </div>
  );
}
