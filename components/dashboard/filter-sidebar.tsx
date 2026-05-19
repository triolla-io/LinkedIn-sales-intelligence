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
  { label: "CEO",             filterKey: "titleSearch", value: "CEO" },
  { label: "COO",             filterKey: "titleSearch", value: "COO" },
  { label: "CFO",             filterKey: "titleSearch", value: "CFO" },
  { label: "CTO",             filterKey: "titleSearch", value: "CTO" },
  { label: "Founder",         filterKey: "titleSearch", value: "Founder" },
  { label: "HR",              filterKey: "function",    value: "HR" },
  { label: "CMO",             filterKey: "titleSearch", value: "CMO" },
  { label: "CPO",             filterKey: "titleSearch", value: "CPO" },
  { label: "Sales",           filterKey: "function",    value: "SALES" },
  { label: "Product Manager", filterKey: "titleSearch", value: "Product Manager" },
];

const INDUSTRY_PILLS = [
  "SaaS", "Fintech", "Healthcare",
  "Real Estate", "E-commerce",
  "Education", "Media", "Manufacturing",
];

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700"
      >
        {title}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
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
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      {/* Search */}
      <div className="p-4 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts…"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filters.q && (
            <button onClick={() => onChange({ ...filters, q: "" })} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Company Size */}
        <Section title="Company Size (employees)">
          <div className="space-y-2">
            {COMPANY_SIZE_BUCKETS.map((b) => (
              <label key={b.value} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={filters.companySizeBuckets.includes(b.value)}
                  onChange={() => toggle("companySizeBuckets", b.value)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900">{b.label}</span>
              </label>
            ))}
          </div>
        </Section>

        {/* Role / Title */}
        <Section title="Role / Title">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ROLE_PILLS.map((pill) => {
              const active = (filters[pill.filterKey] as string[]).includes(pill.value);
              return (
                <button
                  key={pill.label}
                  onClick={() => toggle(pill.filterKey, pill.value)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
          {/* Custom title input */}
          <input
            type="text"
            placeholder="Custom title + Enter…"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            onKeyDown={addCustomTitle}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {filters.titleSearch.filter((t) => !ROLE_PILLS.some((p) => p.value === t)).map((t) => (
            <div key={t} className="flex items-center gap-1 mt-1.5">
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-600 text-white border border-blue-600">
                {t}
              </span>
              <button onClick={() => toggle("titleSearch", t)}>
                <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
          ))}
        </Section>

        {/* Industry */}
        <Section title="Industry" defaultOpen={false}>
          <div className="flex flex-wrap gap-1.5">
            {INDUSTRY_PILLS.map((i) => (
              <button
                key={i}
                onClick={() => toggle("industry", i)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  filters.industry.includes(i)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                )}
              >
                {i}
              </button>
            ))}
          </div>
        </Section>

        {/* Contact info */}
        <Section title="Contact Info">
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!filters.hasEmail}
                onChange={() => onChange({ ...filters, hasEmail: filters.hasEmail ? undefined : true })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Has email</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!filters.hasPhone}
                onChange={() => onChange({ ...filters, hasPhone: filters.hasPhone ? undefined : true })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Has phone</span>
            </label>
          </div>
        </Section>
      </div>

      {/* Clear all */}
      {hasFilters && (
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
