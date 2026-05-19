"use client";

import { useEffect, useState } from "react";
import {
  X,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Building2,
  Zap,
  Send,
  Users,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";

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
  onMessage: (contact: Contact) => void;
}

const SENIORITY_COLOR: Record<string, string> = {
  C_LEVEL: "text-[#f0a928] bg-[#f0a928]/10 border-[#f0a928]/20",
  VP: "text-[#1585ff] bg-[#1585ff]/10 border-[#1585ff]/20",
  DIRECTOR: "text-[#a78bfa] bg-[#a78bfa]/10 border-[#a78bfa]/20",
  MANAGER: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  IC: "text-[#5c7d9e] bg-[#14223a] border-[#25405e]",
  OTHER: "text-[#5c7d9e] bg-[#14223a] border-[#25405e]",
};

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest mb-0.5">{label}</p>
      <p className={cn("text-sm text-[#eaf2fd] break-words", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

export default function ContactDrawer({ contact, onClose, onEnrich, onMessage }: ContactDrawerProps) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [linkedinStatus, setLinkedinStatus] = useState<"ACTIVE" | "DISCONNECTED" | "loading">("loading");

  useEffect(() => {
    fetch("/api/linkedin/session")
      .then((r) => r.json())
      .then((d) => setLinkedinStatus(d.status === "ACTIVE" ? "ACTIVE" : "DISCONNECTED"))
      .catch(() => setLinkedinStatus("DISCONNECTED"));
  }, []);

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
  }, [contact?.id]);

  // Trap focus and close on Escape
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
          "fixed inset-0 bg-black/50 z-30 transition-opacity duration-200",
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 w-[420px] bg-[#162333] border-l border-[#25405e] z-40 flex flex-col",
          "transition-transform duration-200 ease-out",
          visible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {!contact ? null : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-[#1e3248]">
              <div className="flex-1 min-w-0 pr-3">
                <h2 className="text-base font-semibold text-[#eaf2fd] truncate">{contact.fullName}</h2>
                {contact.currentTitle && (
                  <p className="text-sm text-[#5c7d9e] truncate mt-0.5">{contact.currentTitle}</p>
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
                className="text-[#456078] hover:text-[#5c7d9e] transition-colors shrink-0 mt-0.5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {/* Primary CTA */}
              <div className="p-4 border-b border-[#1e3248]">
                {linkedinStatus === "ACTIVE" ? (
                  <button
                    onClick={() => onMessage(contact)}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#1585ff] hover:bg-[#3090ff] text-white text-sm font-medium transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    Send LinkedIn Message
                  </button>
                ) : linkedinStatus === "loading" ? (
                  <button disabled className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#1e3248] text-[#456078] text-sm font-medium cursor-wait">
                    <Send className="w-4 h-4" />
                    Checking LinkedIn…
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button disabled className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#1e3248] text-[#456078] text-sm font-medium cursor-not-allowed opacity-60">
                      <Send className="w-4 h-4" />
                      Send LinkedIn Message
                    </button>
                    <p className="text-xs text-center text-amber-400">
                      LinkedIn not connected.{" "}
                      <a href="/linkedin-connect" className="underline hover:text-amber-300">
                        Connect your account →
                      </a>
                    </p>
                  </div>
                )}
              </div>

              {/* Contact details */}
              <div className="p-4 space-y-4 border-b border-[#1e3248]">
                <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">
                  Contact Details
                </p>

                {contact.email ? (
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-[#1585ff] shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Email</p>
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-sm text-[#9ecfff] hover:text-[#1585ff] transition-colors font-mono"
                      >
                        {contact.email}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Mail className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                    <p className="text-xs text-[#5c7d9e]">No email on record</p>
                  </div>
                )}

                {contact.phone ? (
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Phone</p>
                      <a
                        href={`tel:${contact.phone}`}
                        className="text-sm text-[#eaf2fd] hover:text-white transition-colors font-mono"
                      >
                        {contact.phone}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Phone className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                    <p className="text-xs text-[#5c7d9e]">No phone on record</p>
                  </div>
                )}

                {(!contact.email && !contact.phone) && (
                  <button
                    onClick={() => onEnrich(contact.id)}
                    className="flex items-center gap-2 mt-1 px-3 py-1.5 text-xs text-[#5c7d9e] border border-[#25405e] hover:border-[#f0a928]/30 hover:text-[#f0a928] rounded-md transition-all"
                  >
                    <Zap className="w-3 h-3" />
                    Enrich contact
                  </button>
                )}
              </div>

              {/* Professional info */}
              <div className="p-4 space-y-3 border-b border-[#1e3248]">
                <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">
                  Professional
                </p>
                <div className="space-y-3">
                  {contact.currentCompany && (
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Company</p>
                        <p className="text-sm text-[#eaf2fd] truncate">{contact.currentCompany}</p>
                      </div>
                    </div>
                  )}
                  {contact.companySize && (
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Employees</p>
                        <p className="text-sm font-mono text-[#eaf2fd]">{contact.companySize.toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                  {contact.location && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Location</p>
                        <p className="text-sm text-[#eaf2fd]">{contact.location}</p>
                      </div>
                    </div>
                  )}
                  {contact.industry && (
                    <div>
                      <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest mb-0.5">Industry</p>
                      <p className="text-sm text-[#eaf2fd]">{contact.industry}</p>
                    </div>
                  )}
                  {contact.lastSyncedAt && (
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-4 h-4 text-[#5c7d9e] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest">Last synced</p>
                        <p className="text-xs font-mono text-[#5c7d9e]">
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
                  className="flex items-center gap-2 mt-2 text-xs text-[#5c7d9e] hover:text-[#9ecfff] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View on LinkedIn
                </a>
              </div>

              {/* Message history */}
              <div className="p-4">
                <p className="text-[10px] font-mono text-[#456078] uppercase tracking-widest mb-3">
                  Message History
                </p>
                {loadingMessages ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-lg bg-[#14223a] animate-pulse" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-[#456078]">No messages sent yet.</p>
                ) : (
                  <div className="space-y-2">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className="rounded-lg border border-[#1e3248] bg-[#101c2a] px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono text-[#456078]">
                            {formatDate(msg.sentAt)}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded",
                              msg.status === "SENT"
                                ? "text-emerald-400 bg-emerald-400/10"
                                : msg.status === "QUEUED"
                                ? "text-[#1585ff] bg-[#1585ff]/10"
                                : "text-red-400 bg-red-400/10"
                            )}
                          >
                            {msg.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#9ecfff] leading-relaxed line-clamp-3">{msg.body}</p>
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
