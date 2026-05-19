"use client";

import { useState } from "react";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";

export type Filters = {
  seniority: string[];
  function: string[];
  q: string;
  titleSearch: string[];
  industry: string[];
  companySizeBuckets: string[];

  connectedFrom: string;
  connectedTo: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  seniority: [],
  function: [],
  q: "",
  titleSearch: [],
  industry: [],
  companySizeBuckets: [],

  connectedFrom: "",
  connectedTo: "",
};

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
    <div className="border-b border-[#1e3248] last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-4 py-2.5 text-[10px] font-mono font-semibold text-[#456078] uppercase tracking-widest hover:text-[#5c7d9e] transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {activeCount > 0 && (
            <span className="px-1 py-0.5 rounded bg-[#1585ff]/15 text-[#1585ff] text-[9px] font-mono">
              {activeCount}
            </span>
          )}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#1585ff]/15 text-[#1585ff] border border-[#1585ff]/20">
      {label}
      <button onClick={onRemove} className="hover:text-white transition-colors">
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

interface FilterSidebarProps {
  filters: Filters;
  onChange: (f: Filters) => void;
}

export default function FilterSidebar({ filters, onChange }: FilterSidebarProps) {
  const [customTitle, setCustomTitle] = useState("");

  const hasFilters =
    filters.q ||
    filters.seniority.length ||
    filters.function.length ||
    filters.titleSearch.length ||
    filters.companySizeBuckets.length ||
    filters.industry.length ||
    filters.connectedFrom ||
    filters.connectedTo ||
    filters.hasEmail ||
    filters.hasPhone;

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

  return (
    <div className="flex flex-col h-full bg-[#162333] border-r border-[#1e3248]">
      {/* Search */}
      <div className="p-4 border-b border-[#1e3248]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#456078]" />
          <input
            type="text"
            placeholder="Search contacts…"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            className="w-full pl-9 pr-3 py-2 bg-[#101c2a] border border-[#1e3248] rounded-md text-sm text-[#eaf2fd] placeholder-[#456078] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
          />
          {filters.q && (
            <button onClick={() => onChange({ ...filters, q: "" })} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-[#456078] hover:text-[#5c7d9e]" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Company Size */}
        <Section title="Company Size" activeCount={filters.companySizeBuckets.length}>
          <div className="space-y-1.5">
            {COMPANY_SIZE_BUCKETS.map((b) => {
              const active = filters.companySizeBuckets.includes(b.value);
              return (
                <label key={b.value} className="flex items-center gap-2.5 cursor-pointer group">
                  <div
                    className={cn(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all",
                      active
                        ? "bg-[#1585ff] border-[#1585ff]"
                        : "bg-transparent border-[#25405e] group-hover:border-[#2a4060]"
                    )}
                    onClick={() => toggle("companySizeBuckets", b.value)}
                  >
                    {active && <div className="w-2 h-1.5 border-b-2 border-l-2 border-white -mt-0.5 rotate-[-45deg]" />}
                  </div>
                  <span className={cn(
                    "text-xs transition-colors",
                    active ? "text-[#9ecfff]" : "text-[#5c7d9e] group-hover:text-[#7a9aba]"
                  )}>
                    {b.label}
                  </span>
                </label>
              );
            })}
          </div>
        </Section>

        {/* Role / Title */}
        <Section title="Role / Title" activeCount={filters.titleSearch.length + filters.function.length}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_PILLS.map((pill) => {
              const active = (filters[pill.filterKey] as string[]).includes(pill.value);
              return (
                <button
                  key={pill.label}
                  onClick={() => toggle(pill.filterKey, pill.value)}
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                    active
                      ? "bg-[#1585ff]/15 text-[#1585ff] border-[#1585ff]/30"
                      : "bg-transparent text-[#5c7d9e] border-[#25405e] hover:border-[#2a4060] hover:text-[#7a9aba]"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            placeholder="Custom title + Enter…"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            onKeyDown={addCustomTitle}
            className="w-full px-3 py-1.5 bg-[#101c2a] border border-[#1e3248] rounded-md text-xs text-[#eaf2fd] placeholder-[#456078] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
          />
          <div className="flex flex-wrap gap-1 mt-2">
            {filters.titleSearch
              .filter((t) => !ROLE_PILLS.some((p) => p.value === t))
              .map((t) => (
                <ActivePill key={t} label={t} onRemove={() => toggle("titleSearch", t)} />
              ))}
          </div>
        </Section>

        {/* Industry */}
        <Section title="Industry" defaultOpen={false} activeCount={filters.industry.length}>
          <div className="flex flex-wrap gap-1.5">
            {INDUSTRY_PILLS.map((i) => (
              <button
                key={i}
                onClick={() => toggle("industry", i)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium border transition-all",
                  filters.industry.includes(i)
                    ? "bg-[#1585ff]/15 text-[#1585ff] border-[#1585ff]/30"
                    : "bg-transparent text-[#5c7d9e] border-[#25405e] hover:border-[#2a4060] hover:text-[#7a9aba]"
                )}
              >
                {i}
              </button>
            ))}
          </div>
        </Section>

        {/* Connected Date */}
        <Section
          title="Connected Date"
          defaultOpen={false}
          activeCount={filters.connectedFrom || filters.connectedTo ? 1 : 0}
        >
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] font-mono text-[#456078] uppercase tracking-widest mb-1">
                From
              </label>
              <input
                type="date"
                value={filters.connectedFrom}
                onChange={(e) => onChange({ ...filters, connectedFrom: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#101c2a] border border-[#1e3248] rounded-md text-xs text-[#eaf2fd] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-[#456078] uppercase tracking-widest mb-1">
                To
              </label>
              <input
                type="date"
                value={filters.connectedTo}
                onChange={(e) => onChange({ ...filters, connectedTo: e.target.value })}
                className="w-full px-3 py-1.5 bg-[#101c2a] border border-[#1e3248] rounded-md text-xs text-[#eaf2fd] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors [color-scheme:dark]"
              />
            </div>
            {(filters.connectedFrom || filters.connectedTo) && (
              <button
                onClick={() => onChange({ ...filters, connectedFrom: "", connectedTo: "" })}
                className="text-xs text-[#5c7d9e] hover:text-[#7a9aba] flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear dates
              </button>
            )}
          </div>
        </Section>

        {/* Contact info */}
        <Section title="Contact Info" activeCount={(filters.hasEmail ? 1 : 0) + (filters.hasPhone ? 1 : 0)}>
          <div className="space-y-1.5">
            {[
              { key: "hasEmail" as const, label: "Has email" },
              { key: "hasPhone" as const, label: "Has phone" },
            ].map(({ key, label }) => {
              const active = !!filters[key];
              return (
                <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                  <div
                    className={cn(
                      "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all",
                      active
                        ? "bg-[#1585ff] border-[#1585ff]"
                        : "bg-transparent border-[#25405e] group-hover:border-[#2a4060]"
                    )}
                    onClick={() => onChange({ ...filters, [key]: active ? undefined : true })}
                  >
                    {active && <div className="w-2 h-1.5 border-b-2 border-l-2 border-white -mt-0.5 rotate-[-45deg]" />}
                  </div>
                  <span className={cn(
                    "text-xs transition-colors",
                    active ? "text-[#9ecfff]" : "text-[#5c7d9e] group-hover:text-[#7a9aba]"
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
        <div className="p-3 border-t border-[#1e3248]">
          <button
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-mono text-[#5c7d9e] hover:text-[#7a9aba] border border-[#1e3248] hover:border-[#25405e] rounded-md transition-colors"
          >
            <X className="w-3 h-3" />
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
