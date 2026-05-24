"use client";

import { useRef, useState } from "react";
import { Mail, Phone, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { displayCompanySize } from "@/lib/contacts/display";

export type Contact = {
  id: string;
  fullName: string;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  companySize?: number | null;
  company?: { staffCount: number | null; industry: string | null } | null;
  seniority?: string | null;
  function?: string | null;
  location?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  lastSyncedAt: string;
  enrichedAt?: string | null;
  linkedinUrl: string;
  manualFields?: string[];
};

interface ContactTableProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onEnrich?: (id: string) => void;
  onOpenDrawer: (contact: Contact) => void;
  loading: boolean;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  extraRowAction?: (contact: Contact) => React.ReactNode;
}

const SENIORITY_BADGE: Record<string, string> = {
  C_LEVEL: "text-amber-700 bg-amber-50 border-amber-200",
  VP: "text-blue-600 bg-blue-50 border-blue-200",
  DIRECTOR: "text-violet-600 bg-violet-50 border-violet-200",
  MANAGER: "text-emerald-600 bg-emerald-50 border-emerald-200",
  IC: "text-stone-500 bg-stone-100 border-stone-200",
  OTHER: "text-stone-500 bg-stone-100 border-stone-200",
};

const SENIORITY_LABEL: Record<string, string> = {
  C_LEVEL: "C-Level",
  VP: "VP",
  DIRECTOR: "Director",
  MANAGER: "Manager",
  IC: "IC",
  OTHER: "Other",
};

const EMPLOYEE_THRESHOLDS = [
  { max: 10, label: "1–10", pct: 4 },
  { max: 50, label: "11–50", pct: 12 },
  { max: 200, label: "51–200", pct: 22 },
  { max: 500, label: "201–500", pct: 32 },
  { max: 1000, label: "501–1K", pct: 42 },
  { max: 5000, label: "1K–5K", pct: 58 },
  { max: 10000, label: "5K–10K", pct: 72 },
  { max: 50000, label: "10K–50K", pct: 86 },
  { max: Infinity, label: "50K+", pct: 100 },
];

function employeePct(n: number): { pct: number; label: string } {
  for (const t of EMPLOYEE_THRESHOLDS) {
    if (n <= t.max) return { pct: t.pct, label: n.toLocaleString() };
  }
  return { pct: 100, label: n.toLocaleString() };
}

interface TooltipCellProps {
  text: string;
  className?: string;
  mono?: boolean;
}

function TooltipCell({ text, className, mono = false }: TooltipCellProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative min-w-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <p className={cn("truncate", mono && "font-mono", className)}>{text}</p>
      {show && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 max-w-xs pointer-events-none">
          <div className="bg-white border border-[#e5e3df] rounded px-2.5 py-1.5 text-xs text-[#111110] shadow-lg whitespace-normal wrap-break-word">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonRow({ cols }: { cols: string }) {
  return (
    <div
      className="grid items-center gap-3 px-4 border-b border-[#e5e3df]/70 animate-pulse"
      style={{ gridTemplateColumns: cols, height: 56 }}
    >
      <div className="w-3.5 h-3.5 bg-[#e5e3df] rounded" />
      <div className="space-y-1.5">
        <div className="h-3.5 bg-[#e5e3df] rounded w-28" />
        <div className="h-2.5 bg-[#eeece9] rounded w-40" />
      </div>
      <div className="h-3.5 bg-[#e5e3df] rounded w-20" />
      <div className="h-4 bg-[#e5e3df] rounded-full w-14" />
      <div className="h-3.5 bg-[#e5e3df] rounded w-16" />
      <div className="h-3.5 bg-[#e5e3df] rounded w-12" />
      <div className="flex gap-1.5">
        <div className="h-3.5 w-3.5 bg-[#e5e3df] rounded" />
        <div className="h-3.5 w-3.5 bg-[#e5e3df] rounded" />
      </div>
    </div>
  );
}

// checkbox | name | company | title | employees | seniority | industry | contact-icons
const COLS = "20px minmax(0,1.8fr) minmax(0,1.2fr) minmax(0,1.4fr) 90px 80px minmax(0,1.2fr) 48px";
const COLS_WITH_ACTION = COLS + " 56px";
const ROW_HEIGHT = 56;

export default function ContactTable({
  contacts,
  selectedIds,
  onToggle,
  onSelectAll,
  onEnrich,
  onOpenDrawer,
  loading,
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  extraRowAction,
}: ContactTableProps) {
  const allSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const cols = extraRowAction ? COLS_WITH_ACTION : COLS;

  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  return (
    <div className="rounded-xl border border-[#e5e3df] bg-white overflow-hidden flex flex-col">
      {/* Header row */}
      <div
        className="grid items-center gap-3 px-4 py-2.5 bg-[#f8f7f5] border-b border-[#e5e3df] text-[10px] font-mono text-[#9b9895] uppercase tracking-widest shrink-0"
        style={{ gridTemplateColumns: cols }}
      >
        {loading ? (
          <div className="w-3.5 h-3.5 bg-[#e5e3df] rounded" />
        ) : (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="rounded-sm border-[#d4d0cc] bg-white text-[#1585ff] w-3.5 h-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
        )}
        <span>Name</span>
        <span>Company</span>
        <span>Title</span>
        <span>Employees</span>
        <span>Seniority</span>
        <span>Industry</span>
        <span />
        {extraRowAction && <span />}
      </div>

      {/* Rows */}
      <div className="overflow-hidden">
        {loading ? (
          Array.from({ length: pageSize || 8 }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))
        ) : contacts.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-[#9b9895] font-mono">No contacts match your filters.</p>
          </div>
        ) : (
          contacts.map((contact) => {
            const isSelected = selectedIds.has(contact.id);
            const { value: staffCount } = displayCompanySize(contact);
            const empInfo = staffCount ? employeePct(staffCount) : null;
            const industry = contact.company?.industry ?? contact.industry ?? null;

            return (
              <div
                key={contact.id}
                onClick={() => onOpenDrawer(contact)}
                className={cn(
                  "grid items-center gap-3 px-4 border-b border-[#e5e3df]/70 cursor-pointer transition-colors group",
                  isSelected ? "bg-[#eff5ff]" : "hover:bg-[#f8f7f5]"
                )}
                style={{ gridTemplateColumns: cols, height: ROW_HEIGHT }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => { e.stopPropagation(); onToggle(contact.id); }}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-sm border-[#d4d0cc] bg-white text-[#1585ff] w-3.5 h-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />

                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#111110] truncate group-hover:text-black transition-colors">
                    {contact.fullName}
                  </p>
                  {contact.headline && (
                    <p className="text-[11px] text-[#9b9895] truncate mt-0.5">{contact.headline}</p>
                  )}
                </div>

                <div className="min-w-0">
                  {contact.currentCompany
                    ? <TooltipCell text={contact.currentCompany} className="text-sm text-[#1585ff]" />
                    : <span className="text-[#c8c5c2]">—</span>
                  }
                </div>

                <div className="min-w-0">
                  {contact.currentTitle
                    ? <TooltipCell text={contact.currentTitle} className="text-xs text-[#6b6866]" />
                    : <span className="text-[#c8c5c2]">—</span>
                  }
                </div>

                <div className="min-w-0">
                  {empInfo ? (
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-[#6b6866] tabular-nums">{empInfo.label}</p>
                      <div className="h-1 rounded-full bg-[#e8f0fe] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#1585ff] transition-all"
                          style={{ width: `${empInfo.pct}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-[#c8c5c2]">—</span>
                  )}
                </div>

                <div>
                  {contact.seniority ? (
                    <span
                      className={cn(
                        "inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap",
                        SENIORITY_BADGE[contact.seniority] ?? SENIORITY_BADGE.OTHER
                      )}
                    >
                      {SENIORITY_LABEL[contact.seniority] ?? contact.seniority}
                    </span>
                  ) : (
                    <span className="text-[#c8c5c2]">—</span>
                  )}
                </div>

                <div className="min-w-0">
                  {industry
                    ? <TooltipCell text={industry} className="text-xs text-[#9b9895]" />
                    : <span className="text-[#c8c5c2]">—</span>
                  }
                </div>

                <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                  <span title={contact.email ?? "No email"}>
                    <Mail className={cn("w-3.5 h-3.5", contact.email ? "text-[#1585ff]" : "text-[#d4d0cc]")} />
                  </span>
                  <span title={contact.phone ?? "No phone"}>
                    <Phone className={cn("w-3.5 h-3.5", contact.phone ? "text-emerald-500" : "text-[#d4d0cc]")} />
                  </span>
                </div>

                {extraRowAction && (
                  <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                    {extraRowAction(contact)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination footer */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-[#e5e3df] bg-[#f8f7f5]">
        <span className="text-[11px] font-mono text-[#9b9895]">
          {loading ? "Loading…" : total > 0 ? `${firstItem.toLocaleString()}–${lastItem.toLocaleString()} of ${total.toLocaleString()}` : "0 results"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="p-1 rounded text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-[#9b9895] px-2 tabular-nums">
            {loading ? "…" : `${page} / ${totalPages || 1}`}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="p-1 rounded text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
