"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Building2,
  Zap,
  Users,
  Clock,
  Plus,
  X as XIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";
import ListPopover from "./list-popover";

interface MessageRecord {
  id: string;
  body: string;
  sentAt: string;
  status: string;
}

interface ContactDrawerProps {
  contact: Contact | null;
  onClose: () => void;
  onEnrich: (id: string) => void;
}

const SENIORITY_COLOR: Record<string, string> = {
  C_LEVEL: "text-amber-700 bg-amber-50 border-amber-200",
  VP: "text-blue-600 bg-blue-50 border-blue-200",
  DIRECTOR: "text-violet-600 bg-violet-50 border-violet-200",
  MANAGER: "text-emerald-600 bg-emerald-50 border-emerald-200",
  IC: "text-stone-500 bg-stone-100 border-stone-200",
  OTHER: "text-stone-500 bg-stone-100 border-stone-200",
};

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-0.5">{label}</p>
      <p className={cn("text-sm text-[#111110] break-words", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

export default function ContactDrawer({ contact, onClose, onEnrich }: ContactDrawerProps) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [contactLists, setContactLists] = useState<{ id: string; name: string }[]>([]);
  const [showListPopover, setShowListPopover] = useState(false);
  const addListBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!contact) return;
    setMessages([]);
    setLoadingMessages(true);
    fetch(`/api/contacts/${contact.id}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingMessages(false));

    setContactLists([]);
    fetch(`/api/lists?contactId=${contact.id}`)
      .then((r) => r.json())
      .then((d) => setContactLists(d.lists ?? []))
      .catch(() => {});
  }, [contact?.id]);

  useEffect(() => {
    if (!contact) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contact, onClose]);

  const visible = !!contact;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/20 z-30 transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 w-[420px] bg-white border-l border-[#e5e3df] z-40 flex flex-col shadow-xl",
          "transition-transform duration-200 ease-out",
          visible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {!contact ? null : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-[#e5e3df]">
              <div className="flex-1 min-w-0 pr-3">
                <h2 className="text-base font-semibold text-[#111110] truncate">{contact.fullName}</h2>
                {contact.currentTitle && (
                  <p className="text-sm text-[#6b6866] truncate mt-0.5">{contact.currentTitle}</p>
                )}
                {contact.seniority && (
                  <span
                    className={cn(
                      "inline-block mt-1.5 px-2 py-0.5 rounded border text-xs font-medium",
                      SENIORITY_COLOR[contact.seniority] ?? SENIORITY_COLOR.OTHER
                    )}
                  >
                    {contact.seniority.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-[#9b9895] hover:text-[#6b6866] transition-colors shrink-0 mt-0.5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {/* Contact details */}
              <div className="p-4 space-y-4 border-b border-[#e5e3df]">
                <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  Contact Details
                </p>

                {contact.email ? (
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-[#1585ff] shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Email</p>
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-sm text-[#1585ff] hover:text-[#0a70e0] transition-colors font-mono"
                      >
                        {contact.email}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Mail className="w-4 h-4 text-[#9b9895] shrink-0" />
                    <p className="text-xs text-[#9b9895]">No email on record</p>
                  </div>
                )}

                {contact.phone ? (
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Phone</p>
                      <a
                        href={`tel:${contact.phone}`}
                        className="text-sm text-[#111110] hover:text-black transition-colors font-mono"
                      >
                        {contact.phone}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Phone className="w-4 h-4 text-[#9b9895] shrink-0" />
                    <p className="text-xs text-[#9b9895]">No phone on record</p>
                  </div>
                )}

                {(!contact.email && !contact.phone) && (
                  <button
                    onClick={() => onEnrich(contact.id)}
                    className="flex items-center gap-2 mt-1 px-3 py-1.5 text-xs text-[#6b6866] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all"
                  >
                    <Zap className="w-3 h-3" />
                    Enrich contact
                  </button>
                )}
              </div>

              {/* Professional info */}
              <div className="p-4 space-y-3 border-b border-[#e5e3df]">
                <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  Professional
                </p>
                <div className="space-y-3">
                  {contact.currentCompany && (
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Company</p>
                        <p className="text-sm text-[#111110] truncate">{contact.currentCompany}</p>
                      </div>
                    </div>
                  )}
                  {contact.companySize && (
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Employees</p>
                        <p className="text-sm font-mono text-[#111110]">{contact.companySize.toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                  {contact.location && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Location</p>
                        <p className="text-sm text-[#111110]">{contact.location}</p>
                      </div>
                    </div>
                  )}
                  {contact.industry && (
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-0.5">Industry</p>
                      <p className="text-sm text-[#111110]">{contact.industry}</p>
                    </div>
                  )}
                  {contact.lastSyncedAt && (
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Last synced</p>
                        <p className="text-xs font-mono text-[#9b9895]">
                          {formatDate(contact.lastSyncedAt)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <a
                  href={contact.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 mt-2 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on LinkedIn
                </a>
              </div>

              {/* Lists */}
              <div className="p-4 border-b border-[#e5e3df]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">Lists</p>
                  <div className="relative">
                    <button
                      ref={addListBtnRef}
                      onClick={() => setShowListPopover((v) => !v)}
                      className="flex items-center gap-1 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                    {showListPopover && contact && (
                      <ListPopover
                        contactIds={[contact.id]}
                        onClose={() => {
                          setShowListPopover(false);
                          // Refresh list membership
                          fetch(`/api/lists?contactId=${contact.id}`)
                            .then((r) => r.json())
                            .then((d) => setContactLists(d.lists ?? []));
                        }}
                        anchorRef={addListBtnRef as React.RefObject<HTMLElement>}
                      />
                    )}
                  </div>
                </div>
                {contactLists.length === 0 ? (
                  <p className="text-xs text-[#9b9895]">Not in any list</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {contactLists.map((list) => (
                      <span
                        key={list.id}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1585ff]/10 border border-[#1585ff]/20 text-xs text-[#1585ff]"
                      >
                        {list.name}
                        <button
                          onClick={async () => {
                            await fetch(`/api/lists/${list.id}/members`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ remove: [contact!.id] }),
                            });
                            setContactLists((prev) => prev.filter((l) => l.id !== list.id));
                          }}
                          className="hover:text-red-400 transition-colors"
                        >
                          <XIcon className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Message history */}
              <div className="p-4">
                <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-3">
                  Message History
                </p>
                {loadingMessages ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-lg bg-[#f3f2ef] animate-pulse" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-[#9b9895]">No messages sent yet.</p>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className="rounded-lg border border-[#e5e3df] bg-[#f8f7f5] px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono text-[#9b9895]">
                            {formatDate(msg.sentAt)}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded",
                              msg.status === "SENT"
                                ? "text-emerald-600 bg-emerald-50"
                                : msg.status === "QUEUED"
                                ? "text-blue-600 bg-blue-50"
                                : "text-red-500 bg-red-50"
                            )}
                          >
                            {msg.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#111110] leading-relaxed line-clamp-3">{msg.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
