"use client";

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Mail, Phone, ExternalLink, MoreHorizontal, Zap, Send } from "lucide-react";
import { cn } from "@/lib/cn";

export type Contact = {
  id: string;
  fullName: string;
  headline?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  companySize?: number | null;
  seniority?: string | null;
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
  loading: boolean;
}

const SENIORITY_PILL: Record<string, string> = {
  C_LEVEL: "bg-purple-100 text-purple-700",
  VP: "bg-blue-100 text-blue-700",
  DIRECTOR: "bg-indigo-100 text-indigo-700",
  MANAGER: "bg-green-100 text-green-700",
  IC: "bg-gray-100 text-gray-600",
  OTHER: "bg-gray-100 text-gray-600",
};

function ActionMenu({
  contact,
  onEnrich,
  onMessage,
}: {
  contact: Contact;
  onEnrich: () => void;
  onMessage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
            <button
              onClick={() => { onEnrich(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Zap className="w-3 h-3" />
              Enrich
            </button>
            <button
              onClick={() => { onMessage(); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Send className="w-3 h-3" />
              Message
            </button>
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink className="w-3 h-3" />
              Open in LinkedIn
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 animate-pulse">
      <div className="w-4 h-4 bg-gray-200 rounded" />
      <div className="flex-1 space-y-1">
        <div className="h-4 bg-gray-200 rounded w-32" />
        <div className="h-3 bg-gray-100 rounded w-48" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-24" />
      <div className="h-5 bg-gray-200 rounded-full w-16" />
      <div className="h-4 bg-gray-200 rounded w-20" />
      <div className="flex gap-2">
        <div className="h-4 w-4 bg-gray-200 rounded" />
        <div className="h-4 w-4 bg-gray-200 rounded" />
      </div>
      <div className="h-4 bg-gray-200 rounded w-20" />
      <div className="h-4 w-4 bg-gray-200 rounded" />
    </div>
  );
}

const ROW_HEIGHT = 64;

export default function ContactTable({
  contacts,
  selectedIds,
  onToggle,
  onSelectAll,
  onEnrich,
  onMessage,
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
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <div className="w-4" />
          <span className="flex-1">Name</span>
          <span className="w-36">Company</span>
          <span className="w-20">Seniority</span>
          <span className="w-24">Location</span>
          <span className="w-16">Contact</span>
          <span className="w-24">Last Synced</span>
          <span className="w-8" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-center py-16 text-gray-500">
          <p className="text-sm">No contacts found. Adjust your filters.</p>
        </div>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  const COLS = "16px 1fr 13% 16% 8% 9% 10% 10% 64px 32px";

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* Virtualized body with sticky header inside */}
      <div
        ref={parentRef}
        className="overflow-y-scroll"
        style={{ height: Math.min(totalHeight + 41, 600) }}
      >
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10 grid items-center gap-2 px-3 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider"
          style={{ gridTemplateColumns: COLS }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="rounded border-gray-300 text-blue-600"
          />
          <span>Name</span>
          <span>Company</span>
          <span>Title</span>
          <span>Employees</span>
          <span>Seniority</span>
          <span>Location</span>
          <span>Industry</span>
          <span>Contact</span>
          <span />
        </div>

        <div style={{ height: totalHeight, position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const contact = contacts[virtualRow.index];
            const isSelected = selectedIds.has(contact.id);

            return (
              <div
                key={contact.id}
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
                  "gap-2 px-3 border-b border-gray-100 hover:bg-gray-50 transition-colors",
                  isSelected && "bg-blue-50"
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(contact.id)}
                  className="rounded border-gray-300 text-blue-600"
                />

                {/* Name + headline */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{contact.fullName}</p>
                  {contact.headline && (
                    <p
                      className="text-xs text-gray-400 truncate max-w-[220px]"
                      title={contact.headline}
                    >
                      {contact.headline}
                    </p>
                  )}
                </div>

                {/* Company */}
                <div className="min-w-0">
                  {contact.currentCompany && (
                    <p className="text-sm text-gray-800 truncate font-medium">{contact.currentCompany}</p>
                  )}
                </div>

                {/* Title */}
                <div className="min-w-0">
                  {contact.currentTitle && (
                    <p className="text-sm text-gray-600 truncate" title={contact.currentTitle}>{contact.currentTitle}</p>
                  )}
                </div>

                {/* Employees */}
                <div className="min-w-0">
                  {contact.companySize && (
                    <p className="text-sm text-gray-700">{contact.companySize.toLocaleString()}</p>
                  )}
                </div>

                {/* Seniority pill */}
                <div>
                  {contact.seniority && (
                    <span
                      className={cn(
                        "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                        SENIORITY_PILL[contact.seniority] ?? SENIORITY_PILL.OTHER
                      )}
                    >
                      {contact.seniority.replace(/_/g, " ")}
                    </span>
                  )}
                </div>

                {/* Location */}
                <div className="min-w-0">
                  {contact.location && (
                    <p className="text-xs text-gray-500 truncate" title={contact.location}>{contact.location}</p>
                  )}
                </div>

                {/* Industry */}
                <div className="min-w-0">
                  {contact.industry && (
                    <p className="text-xs text-gray-500 truncate" title={contact.industry}>{contact.industry}</p>
                  )}
                </div>

                {/* Email / Phone icons */}
                <div className="flex items-center gap-2">
                  <span title={contact.email ?? undefined}>
                    <Mail
                      className={cn(
                        "w-4 h-4",
                        contact.email ? "text-blue-500" : "text-gray-200"
                      )}
                    />
                  </span>
                  <span title={contact.phone ?? undefined}>
                    <Phone
                      className={cn(
                        "w-4 h-4",
                        contact.phone ? "text-green-500" : "text-gray-200"
                      )}
                    />
                  </span>
                </div>

                {/* Actions */}
                <div className="flex justify-end">
                  <ActionMenu
                    contact={contact}
                    onEnrich={() => onEnrich(contact.id)}
                    onMessage={() => onMessage(contact)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
