"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Check, Columns3, GripVertical } from "lucide-react";
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
  hebrewFirstName?: string | null;
};

interface ContactTableProps {
  contacts: Contact[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onEnrich?: (id: string) => void;
  onOpenDrawer: (contact: Contact) => void;
  loading: boolean;
  refreshing?: boolean;
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
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative min-w-0"
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      <p className={cn("truncate", mono && "font-mono", className)}>{text}</p>
      {rect && createPortal(
        <div
          className="pointer-events-none fixed z-9999 max-w-xs"
          style={{ left: rect.left, top: rect.top - 6, transform: "translateY(-100%)" }}
        >
          <div className="bg-white border border-[#e5e3df] rounded px-2.5 py-1.5 text-xs text-[#111110] shadow-lg whitespace-normal wrap-break-word">
            {text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Column system ──────────────────────────────────────────────────────────────

type ColumnId = "name" | "company" | "title" | "email" | "phone" | "employees" | "seniority" | "industry";

interface ColumnDef {
  id: ColumnId;
  label: string;
  width: string;
  visible: boolean;
}

const INITIAL_COLUMNS: ColumnDef[] = [
  { id: "name",      label: "שם",        width: "minmax(0,1.8fr)", visible: true },
  { id: "company",   label: "חברה",      width: "minmax(0,1.2fr)", visible: true },
  { id: "title",     label: "תפקיד",     width: "minmax(0,1.4fr)", visible: true },
  { id: "email",     label: "אימייל",    width: "minmax(0,1.3fr)", visible: true },
  { id: "phone",     label: "טלפון",     width: "minmax(0,1.1fr)", visible: true },
  { id: "employees", label: "עובדים",    width: "90px",            visible: true },
  { id: "seniority", label: "Seniority",  width: "80px",            visible: true },
  { id: "industry",  label: "ענף",       width: "minmax(0,1.2fr)", visible: true },
];

function buildGridTemplate(visibleCols: ColumnDef[], hasAction: boolean): string {
  const base = ["20px", ...visibleCols.map((c) => c.width)].join(" ");
  return hasAction ? base + " 56px" : base;
}

function renderCell(col: ColumnDef, contact: Contact) {
  switch (col.id) {
    case "name":
      return (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#111110] truncate group-hover:text-black transition-colors">
            {contact.fullName}
          </p>
          {contact.headline && (
            <p className="text-[11px] text-[#9b9895] truncate mt-0.5">{contact.headline}</p>
          )}
        </div>
      );
    case "company":
      return (
        <div className="min-w-0">
          {contact.currentCompany
            ? <TooltipCell text={contact.currentCompany} className="text-sm text-[#1585ff]" />
            : <span className="text-[#c8c5c2]">—</span>
          }
        </div>
      );
    case "title":
      return (
        <div className="min-w-0">
          {contact.currentTitle
            ? <TooltipCell text={contact.currentTitle} className="text-xs text-[#6b6866]" />
            : <span className="text-[#c8c5c2]">—</span>
          }
        </div>
      );
    case "email":
      return (
        <div className="min-w-0">
          {contact.email
            ? <TooltipCell text={contact.email} className="text-xs text-[#6b6866]" mono />
            : <span className="text-[#c8c5c2]">—</span>
          }
        </div>
      );
    case "phone":
      return (
        <div className="min-w-0">
          {contact.phone
            ? <TooltipCell text={contact.phone} className="text-xs text-[#6b6866]" mono />
            : <span className="text-[#c8c5c2]">—</span>
          }
        </div>
      );
    case "employees": {
      const { value: staffCount } = displayCompanySize(contact);
      const empInfo = staffCount ? employeePct(staffCount) : null;
      return empInfo ? (
        <p className="text-xs font-mono text-[#6b6866] tabular-nums">{empInfo.label}</p>
      ) : (
        <span className="text-[#c8c5c2]">—</span>
      );
    }
    case "seniority":
      return contact.seniority ? (
        <span className={cn(
          "inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap",
          SENIORITY_BADGE[contact.seniority] ?? SENIORITY_BADGE.OTHER
        )}>
          {SENIORITY_LABEL[contact.seniority] ?? contact.seniority}
        </span>
      ) : (
        <span className="text-[#c8c5c2]">—</span>
      );
    case "industry": {
      const industry = contact.company?.industry ?? contact.industry ?? null;
      return (
        <div className="min-w-0">
          {industry
            ? <TooltipCell text={industry} className="text-xs text-[#9b9895]" />
            : <span className="text-[#c8c5c2]">—</span>
          }
        </div>
      );
    }
  }
}

function SkeletonRow({ cols, colCount }: { cols: string; colCount: number }) {
  return (
    <div
      className="grid items-center gap-3 px-4 border-b border-[#e5e3df]/70 animate-pulse"
      style={{ gridTemplateColumns: cols, height: 56 }}
    >
      <div className="w-3.5 h-3.5 bg-[#e5e3df] rounded" />
      {Array.from({ length: colCount }).map((_, i) => (
        <div key={i} className="h-3.5 bg-[#e5e3df] rounded w-3/4" />
      ))}
    </div>
  );
}

const ROW_HEIGHT = 56;

export default function ContactTable({
  contacts,
  selectedIds,
  onToggle,
  onSelectAll,
  onOpenDrawer,
  loading,
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  extraRowAction,
}: ContactTableProps) {
  const [columns, setColumns] = useState<ColumnDef[]>(INITIAL_COLUMNS);
  const [showColMenu, setShowColMenu] = useState(false);
  const [dragColId, setDragColId] = useState<ColumnId | null>(null);
  const [overColId, setOverColId] = useState<ColumnId | null>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  const visibleCols = columns.filter((c) => c.visible);
  const cols = buildGridTemplate(visibleCols, !!extraRowAction);
  const allSelected = contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

  // Close column menu on outside click
  useEffect(() => {
    if (!showColMenu) return;
    function handleClick(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColMenu]);

  function toggleColVisibility(id: ColumnId) {
    setColumns((prev) => {
      const visibleCount = prev.filter((c) => c.visible).length;
      const col = prev.find((c) => c.id === id);
      if (col?.visible && visibleCount <= 1) return prev;
      return prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c));
    });
  }

  function handleDragStart(e: React.DragEvent, id: ColumnId) {
    e.dataTransfer.effectAllowed = "move";
    setDragColId(id);
  }

  function handleDragOver(e: React.DragEvent, id: ColumnId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragColId) setOverColId(id);
  }

  function handleDrop(targetId: ColumnId) {
    if (!dragColId || dragColId === targetId) return;
    setColumns((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((c) => c.id === dragColId);
      const toIdx = arr.findIndex((c) => c.id === targetId);
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    setDragColId(null);
    setOverColId(null);
  }

  function handleDragEnd() {
    setDragColId(null);
    setOverColId(null);
  }

  return (
    <div className="relative">
    <div className="rounded-xl border border-[#e5e3df] bg-white overflow-hidden flex flex-col">
      {/* Header row */}
      <div
        className="grid items-center gap-3 px-4 pr-10 py-2.5 bg-[#f8f7f5] border-b border-[#e5e3df] text-[10px] font-mono text-[#9b9895] uppercase tracking-widest shrink-0"
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

        {visibleCols.map((col) => (
          <span key={col.id}>{col.label}</span>
        ))}

        {extraRowAction && <span />}
      </div>

      {/* Rows */}
      <div className="overflow-hidden">
        {loading ? (
          Array.from({ length: pageSize || 8 }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} colCount={visibleCols.length} />
          ))
        ) : contacts.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-[#9b9895] font-mono">לא נמצאו אנשי קשר.</p>
          </div>
        ) : (
          contacts.map((contact) => {
            const isSelected = selectedIds.has(contact.id);
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

                {visibleCols.map((col) => (
                  <div key={col.id} className="min-w-0">
                    {renderCell(col, contact)}
                  </div>
                ))}

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
          {loading
            ? "בטעינה…"
            : total > 0
            ? `${firstItem.toLocaleString()}–${lastItem.toLocaleString()} מתוך ${total.toLocaleString()} אנשי קשר`
            : "0 תוצאות"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="p-1 rounded text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="עמוד קודם"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-[#9b9895] px-2 tabular-nums">
            {loading ? "…" : `${page} / ${totalPages || 1}`}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="p-1 rounded text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="עמוד הבא"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    {/* Column visibility toggle — outside overflow-hidden so the dropdown isn't clipped */}
    <div ref={colMenuRef} className="absolute right-2 top-0 h-9 flex items-center z-10">
      <button
        onClick={() => setShowColMenu((v) => !v)}
        title="Toggle columns"
        className={cn(
          "p-1 rounded transition-colors",
          showColMenu ? "bg-[#e8f0fe] text-[#1585ff]" : "text-[#9b9895] hover:text-[#111110] hover:bg-[#f3f2ef]"
        )}
      >
        <Columns3 className="w-3.5 h-3.5" />
      </button>

      {showColMenu && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-white border border-[#e5e3df] rounded-lg shadow-lg py-1.5 w-52">
          <p className="text-[9px] font-mono text-[#9b9895] uppercase tracking-widest px-3 pt-0.5 pb-2">
            עמודות
          </p>
          {columns.map((col) => (
            <div
              key={col.id}
              draggable
              onDragStart={(e) => handleDragStart(e, col.id)}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDrop={() => handleDrop(col.id)}
              onDragEnd={handleDragEnd}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 transition-colors select-none",
                overColId === col.id && dragColId !== col.id ? "bg-[#e8f0fe]" : "hover:bg-[#f8f7f5]",
                dragColId === col.id && "opacity-40"
              )}
            >
              <GripVertical className="w-3.5 h-3.5 text-[#c8c5c2] cursor-grab active:cursor-grabbing shrink-0" />
              <button
                onClick={() => toggleColVisibility(col.id)}
                className="flex items-center gap-2 flex-1 min-w-0"
              >
                <div className={cn(
                  "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                  col.visible ? "bg-[#1585ff] border-[#1585ff]" : "border-[#d4d0cc]"
                )}>
                  {col.visible && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </div>
                <span className="text-xs text-[#111110] truncate">{col.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
