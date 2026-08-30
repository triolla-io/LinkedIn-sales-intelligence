"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Columns3, GripVertical, Check, Users } from "lucide-react";
import { Button, Chip, Skeleton } from "@heroui/react";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { displayCompanySize } from "@/lib/contacts/display";
import { classify } from "@/lib/classifier/seniority";

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
  connectedAt?: string | null;
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

const SENIORITY_CHIP_COLOR: Record<string, "warning" | "accent" | "success" | "default"> = {
  C_LEVEL: "warning",
  VP: "accent",
  DIRECTOR: "accent",
  MANAGER: "success",
  IC: "default",
  OTHER: "default",
};

const SENIORITY_LABEL: Record<string, string> = {
  C_LEVEL: "C-Level",
  VP: "VP",
  DIRECTOR: "Director",
  MANAGER: "Manager",
  IC: "IC",
  OTHER: "Other",
};

interface TooltipCellProps {
  text: string;
  className?: string;
  mono?: boolean;
  dir?: "ltr" | "rtl";
}

function TooltipCell({ text, className, mono = false, dir = "ltr" }: TooltipCellProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative min-w-0"
      dir={dir}
      onMouseEnter={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={() => setRect(null)}
    >
      <p className={cn("truncate", mono && "font-mono", className)}>{text}</p>
      {rect && createPortal(
        <div
          className="pointer-events-none fixed z-9999 max-w-xs"
          style={{ left: rect.left, top: rect.top - 6, transform: "translateY(-100%)" }}
        >
          <div className="bg-surface border border-[var(--line)] rounded px-2.5 py-1.5 text-xs text-[var(--foreground)] shadow-lg whitespace-normal wrap-break-word">
            {text}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

type ColumnId = "name" | "hebrewName" | "company" | "title" | "email" | "phone" | "seniority" | "industry";

interface ColumnDef {
  id: ColumnId;
  label: string;
  width: string;
  visible: boolean;
}

const INITIAL_COLUMNS: ColumnDef[] = [
  // כותרות בעברית — במוצר שכל ההבטחה שלו היא הודעה עברית מלוטשת,
  // שורת כותרות באנגלית אומרת ללקוח שהמערכת לא באמת יודעת עברית.
  { id: "name",       label: "שם",          width: "minmax(160px,2fr)",   visible: true },
  { id: "hebrewName", label: "שם בעברית",   width: "minmax(90px,0.8fr)",  visible: true },
  { id: "company",    label: "חברה",        width: "minmax(140px,1.6fr)", visible: true },
  { id: "title",      label: "תפקיד",       width: "minmax(140px,1.6fr)", visible: true },
  { id: "email",      label: "אימייל",      width: "minmax(140px,1.4fr)", visible: true },
  { id: "phone",      label: "טלפון",       width: "minmax(100px,1fr)",   visible: true },
  { id: "seniority",  label: "בכירות",      width: "minmax(80px,0.7fr)",  visible: true },
  { id: "industry",   label: "ענף",         width: "minmax(110px,1.2fr)", visible: false },
];

function buildGridTemplate(visibleCols: ColumnDef[], hasAction: boolean): string {
  const base = ["20px", ...visibleCols.map((c) => c.width)].join(" ");
  return hasAction ? base + " 56px" : base;
}

function CellRenderer({ col, contact }: { col: ColumnDef; contact: Contact }) {
  switch (col.id) {
    case "name":
      return (
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-ink transition-colors">
            {contact.fullName}
          </p>
          {contact.headline && (
            <p className="text-[11px] text-[var(--faint)] truncate mt-0.5">{contact.headline}</p>
          )}
        </div>
      );
    case "hebrewName":
      return (
        <div className="min-w-0">
          {contact.hebrewFirstName
            ? <TooltipCell text={contact.hebrewFirstName} className="text-sm text-[var(--foreground)] font-medium" />
            : <span className="text-[var(--faint)]">-</span>}
        </div>
      );
    case "company": {
      const { value: empCount } = displayCompanySize(contact);
      return (
        <div className="min-w-0">
          {contact.currentCompany ? (
            <div className="min-w-0">
              <TooltipCell text={contact.currentCompany} className="text-sm text-[var(--accent)]" />
              {empCount != null && empCount > 0 && (
                <p className="text-[11px] font-mono text-[var(--faint)] tabular-nums mt-0.5" dir="ltr">
                  {empCount.toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <span className="text-[var(--faint)]">-</span>
          )}
        </div>
      );
    }
    case "title":
      return (
        <div className="min-w-0">
          {contact.currentTitle
            ? <TooltipCell text={contact.currentTitle} className="text-xs text-[var(--muted)]" />
            : <span className="text-[var(--faint)]">-</span>}
        </div>
      );
    case "email":
      return (
        <div className="min-w-0">
          {contact.email
            ? <TooltipCell text={contact.email} className="text-xs text-[var(--muted)]" mono />
            : <span className="text-[var(--faint)]">-</span>}
        </div>
      );
    case "phone":
      return (
        <div className="min-w-0">
          {contact.phone
            ? <TooltipCell text={contact.phone} className="text-xs text-[var(--muted)]" mono />
            : <span className="text-[var(--faint)]">-</span>}
        </div>
      );
    case "seniority": {
      const seniority = contact.currentTitle ? classify(contact.currentTitle).seniority : contact.seniority;
      return seniority ? (
        <Chip
          color={SENIORITY_CHIP_COLOR[seniority] ?? "default"}
          variant="soft"
          size="sm"
        >
          {SENIORITY_LABEL[seniority] ?? seniority}
        </Chip>
      ) : (
        <span className="text-[var(--faint)]">-</span>
      );
    }
    case "industry": {
      const industry = contact.company?.industry ?? contact.industry ?? null;
      return (
        <div className="min-w-0">
          {industry
            ? <TooltipCell text={industry} className="text-xs text-[var(--faint)]" />
            : <span className="text-[var(--faint)]">-</span>}
        </div>
      );
    }
    default:
      return null;
  }
}

function SkeletonRow({ cols, colCount }: { cols: string; colCount: number }) {
  return (
    <div
      className="grid items-center gap-3 px-4 border-b border-[var(--line)]/70 animate-pulse"
      style={{ gridTemplateColumns: cols, height: 56 }}
    >
      <Skeleton className="size-3.5 rounded" />
      {Array.from({ length: colCount }).map((_, i) => (
        <Skeleton key={i} className="h-3.5 rounded w-3/4" />
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
    <div className="relative w-full min-w-0" dir="ltr">
      <div className="rounded-xl border border-[var(--line)] bg-surface overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="w-full">

          {/* Header */}
          <div
            className="grid items-center gap-3 px-4 py-2.5 bg-[var(--surface-secondary)] border-b border-[var(--line)] text-[11px] font-semibold text-[var(--muted)] tracking-[0.02em] shrink-0"
            style={{ gridTemplateColumns: cols }}
          >
            {loading ? (
              <Skeleton className="size-3.5 rounded" />
            ) : (
              <input
                type="checkbox"
                aria-label="בחר הכל"
                checked={allSelected}
                onChange={onSelectAll}
                className="rounded-sm border-[var(--faint)] bg-surface text-[var(--accent)] size-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
            )}
            {visibleCols.map((col) => (
              <span key={col.id} className="text-left">{col.label}</span>
            ))}
            {extraRowAction && <span />}
          </div>

          {/* Rows */}
          <div>
            {loading ? (
              Array.from({ length: pageSize || 8 }).map((_, i) => (
                <SkeletonRow key={i} cols={cols} colCount={visibleCols.length} />
              ))
            ) : contacts.length === 0 ? (
              <div className="px-4 py-10">
                <EmptyState
                  variant="filtered"
                  icon={Users}
                  title="אין אנשי קשר שעונים לסינון"
                  reason="יש אנשי קשר במערכת — הפילטרים הפעילים פשוט לא מחזירים אף אחד מהם."
                  next="אפשר לנקות סינון אחד ולנסות שוב, או לחפש לפי שם."
                />
              </div>
            ) : (
              contacts.map((contact) => {
                const isSelected = selectedIds.has(contact.id);
                return (
                  <div
                    key={contact.id}
                    className={cn(
                      "relative grid items-center gap-3 px-4 border-b border-[var(--line)]/70 transition-colors group w-full",
                      isSelected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-secondary)]"
                    )}
                    style={{ gridTemplateColumns: cols, height: ROW_HEIGHT }}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={() => onOpenDrawer(contact)}
                      className="absolute inset-0 cursor-pointer"
                    />
                    <input
                      type="checkbox"
                      aria-label={`בחר ${contact.fullName}`}
                      checked={isSelected}
                      onChange={(e) => { e.stopPropagation(); onToggle(contact.id); }}
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 rounded-sm border-[var(--faint)] bg-surface text-[var(--accent)] size-3.5 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                    />
                    {visibleCols.map((col) => (
                      <div key={col.id} className="relative z-10 min-w-0 pointer-events-none">
                        <CellRenderer col={col} contact={contact} />
                      </div>
                    ))}
                    {extraRowAction && (
                      <div className="relative z-10 flex items-center justify-end" onClick={(e) => e.stopPropagation()} role="presentation">
                        {extraRowAction(contact)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          </div>{/* end min-w-max */}
        </div>

        {/* Pagination footer */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-[var(--line)] bg-[var(--surface-secondary)]">
          <span className="text-[11px] font-mono text-[var(--faint)]">
            {loading
              ? "בטעינה…"
              : total > 0
              ? `${firstItem.toLocaleString()}–${lastItem.toLocaleString()} מתוך ${total.toLocaleString()} אנשי קשר`
              : "0 תוצאות"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={() => onPageChange(page - 1)}
              isDisabled={page <= 1 || loading}
              aria-label="עמוד קודם"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-[11px] font-mono text-[var(--faint)] px-2 tabular-nums">
              {loading ? "…" : `${page} / ${totalPages || 1}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={() => onPageChange(page + 1)}
              isDisabled={page >= totalPages || loading}
              aria-label="עמוד הבא"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Column visibility toggle – outside overflow-hidden so dropdown isn't clipped */}
      <div ref={colMenuRef} className="absolute right-1 top-0 h-9 flex items-center z-20">
        <button
          type="button"
          onClick={() => setShowColMenu((v) => !v)}
          aria-label="הצג/הסתר עמודות"
          className={cn(
            "p-1 rounded transition-colors",
            showColMenu ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--faint)] hover:text-[var(--foreground)] hover:bg-[var(--surface-secondary)]"
          )}
        >
          <Columns3 className="size-3.5" />
        </button>

        {showColMenu && (
          <div className="absolute top-full right-0 mt-1 z-50 bg-surface border border-[var(--line)] rounded-lg shadow-lg py-1.5 w-52">
            <p className="text-[9px] tabular-nums text-[var(--faint)] tracking-normal px-3 pt-0.5 pb-2">
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
                  overColId === col.id && dragColId !== col.id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-secondary)]",
                  dragColId === col.id && "opacity-40"
                )}
              >
                <GripVertical className="size-3.5 text-[var(--faint)] cursor-grab active:cursor-grabbing shrink-0" />
                <button
                  type="button"
                  onClick={() => toggleColVisibility(col.id)}
                  aria-label={`${col.visible ? "הסתר" : "הצג"} עמודת ${col.label}`}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <div className={cn(
                    "size-3.5 rounded border flex items-center justify-center shrink-0 transition-colors",
                    col.visible ? "bg-[var(--accent)] border-[var(--accent)]" : "border-[var(--faint)]"
                  )}>
                    {col.visible && <Check className="size-2.5 text-white" strokeWidth={3} />}
                  </div>
                  <span className="text-xs text-[var(--foreground)] truncate">{col.label}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
