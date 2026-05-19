"use client";

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mail, Phone } from "lucide-react";
import { cn } from "@/lib/cn";

export type Contact = {
  id: string;
  fullName: string;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  companySize?: number | null;
  seniority?: string | null;
  function?: string | null;
  location?: string | null;
  industry?: string | null;
  email?: string | null;
  phone?: string | null;
  lastSyncedAt: string;
  linkedinUrl: string;
};

interface ContactTableProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onEnrich: (id: string) => void;
  onMessage: (contact: Contact) => void;
  onOpenDrawer: (contact: Contact) => void;
  loading: boolean;
}

const SENIORITY_BADGE: Record<string, string> = {
  C_LEVEL: "text-[#f0a928] bg-[#f0a928]/10 border-[#f0a928]/20",
  VP: "text-[#1585ff] bg-[#1585ff]/10 border-[#1585ff]/20",
  DIRECTOR: "text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20",
  MANAGER: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  IC: "text-[#5c7d9e] bg-[#14223a] border-[#25405e]",
  OTHER: "text-[#5c7d9e] bg-[#14223a] border-[#25405e]",
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
          <div className="bg-[#101c2a] border border-[#25405e] rounded px-2.5 py-1.5 text-xs text-[#eaf2fd] shadow-xl whitespace-normal break-words">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e3248]/60 animate-pulse">
      <div className="w-3.5 h-3.5 bg-[#1e3248] rounded" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-[#1e3248] rounded w-28" />
        <div className="h-2.5 bg-[#14223a] rounded w-40" />
      </div>
      <div className="h-3.5 bg-[#1e3248] rounded w-20" />
      <div className="h-4 bg-[#1e3248] rounded-full w-14" />
      <div className="h-3.5 bg-[#1e3248] rounded w-16" />
      <div className="h-3.5 bg-[#1e3248] rounded w-12" />
      <div className="flex gap-1.5">
        <div className="h-3.5 w-3.5 bg-[#1e3248] rounded" />
        <div className="h-3.5 w-3.5 bg-[#1e3248] rounded" />
      </div>
    </div>
  );
}

const ROW_HEIGHT = 56;
// checkbox | name | company | title | employees | seniority | industry | contact-icons
const COLS = "20px minmax(0,1.8fr) minmax(0,1.2fr) minmax(0,1.4fr) 90px 80px minmax(0,1.2fr) 48px";

export default function ContactTable({
  contacts,
  selectedIds,
  onToggle,
  onSelectAll,
  onEnrich,
  onMessage,
  onOpenDrawer,
  loading,
}: ContactTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const allSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));

  const virtualizer = useVirtualizer({
    count: contacts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (loading) {
    return (
      <div className="rounded-xl border border-[#1e3248] bg-[#162333] overflow-hidden">
        <div
          className="grid items-center gap-3 px-4 py-2.5 bg-[#101c2a] border-b border-[#1e3248] text-[10px] font-mono text-[#456078] uppercase tracking-widest"
          style={{ gridTemplateColumns: COLS }}
        >
          <div className="w-3.5 h-3.5 bg-[#1e3248] rounded" />
          {["Name", "Company", "Title", "Employees", "Seniority", "Location", "Industry", ""].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border border-[#1e3248] bg-[#162333] flex items-center justify-center py-20">
        <p className="text-sm text-[#456078] font-mono">No contacts match your filters.</p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <div className="rounded-xl border border-[#1e3248] bg-[#162333] overflow-hidden flex-1 min-h-0">
      <div
        ref={parentRef}
        className="overflow-y-auto"
        style={{ height: Math.min(totalHeight + 37, 680) }}
      >
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10 grid items-center gap-3 px-4 py-2.5 bg-[#101c2a] border-b border-[#1e3248] text-[10px] font-mono text-[#456078] uppercase tracking-widest"
          style={{ gridTemplateColumns: COLS }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="rounded-sm border-[#25405e] bg-[#14223a] text-[#1585ff] w-3.5 h-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
          <span>Name</span>
          <span>Company</span>
          <span>Title</span>
          <span>Employees</span>
          <span>Seniority</span>
          <span>Industry</span>
          <span />
        </div>

        <div style={{ height: totalHeight, position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const contact = contacts[virtualRow.index];
            const isSelected = selectedIds.has(contact.id);
            const empInfo = contact.companySize ? employeePct(contact.companySize) : null;

            return (
              <div
                key={contact.id}
                onClick={() => onOpenDrawer(contact)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: "grid",
                  gridTemplateColumns: COLS,
                  alignItems: "center",
                }}
                className={cn(
                  "gap-3 px-4 border-b border-[#1e3248]/50 cursor-pointer transition-colors group",
                  isSelected
                    ? "bg-[#1585ff]/8"
                    : "hover:bg-[#1c3048]"
                )}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => { e.stopPropagation(); onToggle(contact.id); }}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-sm border-[#25405e] bg-[#14223a] text-[#1585ff] w-3.5 h-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />

                {/* Name + headline */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#eaf2fd] truncate group-hover:text-white transition-colors">
                    {contact.fullName}
                  </p>
                  {contact.headline && (
                    <p className="text-[11px] text-[#456078] truncate mt-0.5">{contact.headline}</p>
                  )}
                </div>

                {/* Company */}
                <div className="min-w-0">
                  {contact.currentCompany
                    ? <TooltipCell text={contact.currentCompany} className="text-sm text-[#9ecfff]" />
                    : <span className="text-[#25405e]">—</span>
                  }
                </div>

                {/* Title */}
                <div className="min-w-0">
                  {contact.currentTitle
                    ? <TooltipCell text={contact.currentTitle} className="text-xs text-[#7a9aba]" />
                    : <span className="text-[#25405e]">—</span>
                  }
                </div>

                {/* Employees bar */}
                <div className="min-w-0">
                  {empInfo ? (
                    <div className="space-y-1">
                      <p className="text-xs font-mono text-[#7a9aba] tabular-nums">{empInfo.label}</p>
                      <div className="h-1 rounded-full bg-[#1e3248] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#1e4a7a] transition-all"
                          style={{ width: `${empInfo.pct}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-[#25405e]">—</span>
                  )}
                </div>

                {/* Seniority */}
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
                    <span className="text-[#25405e]">—</span>
                  )}
                </div>

                {/* Industry */}
                <div className="min-w-0">
                  {contact.industry
                    ? <TooltipCell text={contact.industry} className="text-xs text-[#5c7d9e]" />
                    : <span className="text-[#25405e]">—</span>
                  }
                </div>

                {/* Contact icons */}
                <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                  <span title={contact.email ?? "No email"}>
                    <Mail className={cn("w-3.5 h-3.5", contact.email ? "text-[#1585ff]" : "text-[#25405e]")} />
                  </span>
                  <span title={contact.phone ?? "No phone"}>
                    <Phone className={cn("w-3.5 h-3.5", contact.phone ? "text-emerald-400" : "text-[#25405e]")} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
