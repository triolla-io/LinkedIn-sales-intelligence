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
  RefreshCw,
  CheckCircle2,
  X as XIcon,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Contact } from "./contact-table";
import ListPopover from "./list-popover";
import EditContactModal from "./edit-contact-modal";
import { toast } from "@/lib/toast";
import { displayCompanySize } from "@/lib/contacts/display";

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
  onSaved?: (updated: Contact) => void;
}

// Local contact state extends the shared Contact type with enrichment-detail fields
// returned inline from the sync enrich route.
interface LocalContact extends Contact {
  enrichmentSource?: string | null;
  enrichmentLog?: unknown;
  enrichmentRanAt?: string | null;
  enrichmentError?: string | null;
}

const SENIORITY_COLOR: Record<string, string> = {
  C_LEVEL: "text-amber-700 bg-amber-50 border-amber-200",
  VP: "text-blue-600 bg-blue-50 border-blue-200",
  DIRECTOR: "text-violet-600 bg-violet-50 border-violet-200",
  MANAGER: "text-emerald-600 bg-emerald-50 border-emerald-200",
  IC: "text-stone-500 bg-stone-100 border-stone-200",
  OTHER: "text-stone-500 bg-stone-100 border-stone-200",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export default function ContactDrawer({ contact, onClose, onEnrich, onSaved }: ContactDrawerProps) {
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [contactLists, setContactLists] = useState<{ id: string; name: string }[]>([]);
  const [showListPopover, setShowListPopover] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [localContact, setLocalContact] = useState<LocalContact | null>(contact);
  const [enrichState, setEnrichState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [mobilePending, setMobilePending] = useState(false);
  const [showEnrichDetails, setShowEnrichDetails] = useState(false);
  const [showRawLog, setShowRawLog] = useState(false);
  const mobilePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const addListBtnRef = useRef<HTMLButtonElement>(null);

  // Reset state when the contact changes
  useEffect(() => {
    setLocalContact(contact);
    setShowEdit(false);
    setEnrichState("idle");
    setEnrichError(null);
    setMobilePending(false);
    setShowEnrichDetails(false);
    setShowRawLog(false);
    if (mobilePollRef.current) {
      clearInterval(mobilePollRef.current);
      mobilePollRef.current = null;
    }
  }, [contact?.id]);

  // Cleanup mobile poll on unmount
  useEffect(() => {
    return () => {
      if (mobilePollRef.current) clearInterval(mobilePollRef.current);
    };
  }, []);

  // Auto-poll for mobile phone when mobilePending is true (max 10 × 30s = 5min)
  useEffect(() => {
    if (!mobilePending || !localContact) return;
    if (mobilePollRef.current) clearInterval(mobilePollRef.current);

    let attempts = 0;
    mobilePollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`/api/contacts/${localContact.id}`);
        if (!r.ok) return;
        const data = await r.json();
        if (data.phone && data.phone !== localContact.phone) {
          clearInterval(mobilePollRef.current!);
          mobilePollRef.current = null;
          setLocalContact((prev) => prev ? { ...prev, phone: data.phone } : prev);
          setMobilePending(false);
          toast.success(`${localContact.fullName} · Mobile phone received`, "Webhook delivered the mobile number.");
        }
      } catch {
        // ignore transient errors
      }
      if (attempts >= 10) {
        clearInterval(mobilePollRef.current!);
        mobilePollRef.current = null;
        setMobilePending(false);
      }
    }, 30_000);

    return () => {
      if (mobilePollRef.current) {
        clearInterval(mobilePollRef.current);
        mobilePollRef.current = null;
      }
    };
  }, [mobilePending, localContact?.id]);

  async function handleEnrich() {
    if (!localContact) return;
    setEnrichState("loading");
    setEnrichError(null);

    try {
      const res = await fetch(`/api/contacts/${localContact.id}/enrich`, { method: "POST" });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          res.status === 402 || data?.error === "BUDGET_EXHAUSTED"
            ? "Credit limit reached"
            : res.status === 502
            ? `Apollo error: ${data?.detail ?? "network error"}`
            : "Enrichment failed";
        setEnrichError(msg);
        setEnrichState("error");
        toast.error("Enrichment failed", msg);
        return;
      }

      const data = await res.json();

      // Merge response into localContact
      setLocalContact((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          email: data.email ?? prev.email,
          phone: data.phone ?? prev.phone,
          companySize: data.companySize ?? prev.companySize,
          currentCompany: data.currentCompany ?? prev.currentCompany,
          industry: data.industry ?? prev.industry,
          enrichedAt: data.enrichmentRanAt ?? prev.enrichedAt,
          enrichmentSource: data.source,
          enrichmentLog: data.enrichmentLog ?? prev.enrichmentLog,
          enrichmentRanAt: data.enrichmentRanAt ?? prev.enrichmentRanAt,
          enrichmentError: null,
        };
      });

      setEnrichState("done");
      onEnrich(localContact.id);

      if (data.mobilePending) {
        setMobilePending(true);
      }

      // Fire appropriate toast
      if (!data.email && !data.phone) {
        toast.info(
          `${localContact.fullName} · לא נמצאו נתונים`,
          data.source === "cache" ? "Apollo כבר נשאל על קשר זה ולא מצא נתונים." : "לא נמצא אימייל או טלפון עבור פרופיל זה."
        );
      } else if (data.source === "cache") {
        const found: string[] = [];
        if (data.email) found.push("אימייל");
        if (data.phone) found.push("טלפון");
        toast.info(
          `${localContact.fullName} · נטען מהמטמון`,
          `נמצא: ${found.join(", ")}`
        );
      } else {
        const found: string[] = [];
        const missing: string[] = [];
        if (data.email) found.push("email");
        else missing.push("email");
        if (data.phone) found.push("work phone");
        else if (data.mobilePending) missing.push("mobile (verifying…)");
        else missing.push("phone");

        const foundStr = found.length ? `Found: ${found.join(", ")}` : "";
        const missingStr = missing.length ? `Missing: ${missing.join(", ")}` : "";
        const body = [foundStr, missingStr].filter(Boolean).join(" · ");
        toast.success(`${localContact.fullName} enriched`, body);
      }
    } catch {
      setEnrichError("Network error");
      setEnrichState("error");
      toast.error("Enrichment failed", "Network error — check your connection.");
    }
  }

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
      if (e.key === "Escape") {
        if (showEdit) return;
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contact, onClose, showEdit]);

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
          "fixed left-0 top-0 bottom-0 w-[420px] bg-white border-r border-[#e5e3df] z-40 flex flex-col shadow-xl",
          "transition-transform duration-200 ease-out",
          visible ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {!contact || !localContact ? null : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-[#e5e3df]">
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-[#111110] truncate">{localContact.fullName}</h2>
                  {localContact.hebrewFirstName && (
                    <span className="text-sm text-[#9b9895] shrink-0">{localContact.hebrewFirstName}</span>
                  )}
                </div>
                {localContact.currentTitle && (
                  <p className="text-sm text-[#6b6866] truncate mt-0.5">{localContact.currentTitle}</p>
                )}
                {localContact.seniority && (
                  <span
                    dir="ltr"
                    className={cn(
                      "inline-block mt-1.5 px-2 py-0.5 rounded border text-xs font-medium",
                      SENIORITY_COLOR[localContact.seniority] ?? SENIORITY_COLOR.OTHER
                    )}
                  >
                    {localContact.seniority.replace(/_/g, " ")}
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
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                    פרטי קשר
                  </p>
                  <button
                    onClick={() => setShowEdit(true)}
                    className="text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                  >
                    ערוך
                  </button>
                </div>

                {localContact.email ? (
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-[#1585ff] shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">אימייל</p>
                      <a
                        href={`mailto:${localContact.email}`}
                        className="text-sm text-[#1585ff] hover:text-[#0a70e0] transition-colors font-mono"
                      >
                        {localContact.email}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Mail className="w-4 h-4 text-[#9b9895] shrink-0" />
                    <p className="text-xs text-[#9b9895]">אין אימייל בנתונים</p>
                  </div>
                )}

                {localContact.phone ? (
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">טלפון</p>
                      <a
                        href={`tel:${localContact.phone}`}
                        className="text-sm text-[#111110] hover:text-black transition-colors font-mono"
                        style={{ direction: "ltr", unicodeBidi: "isolate", display: "inline-block" }}
                      >
                        {localContact.phone}
                      </a>
                    </div>
                  </div>
                ) : mobilePending ? (
                  <div className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">טלפון</p>
                      <p className="text-xs text-amber-500 font-mono">אימות טלפון נייד דרך webhook…</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 opacity-40">
                    <Phone className="w-4 h-4 text-[#9b9895] shrink-0" />
                    <p className="text-xs text-[#9b9895]">אין טלפון בנתונים</p>
                  </div>
                )}

                {!localContact.email && !localContact.phone && !mobilePending && (
                  <div className="mt-1 space-y-1.5">
                    {enrichState === "idle" && (
                      <button
                        onClick={handleEnrich}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6b6866] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all"
                      >
                        <Zap className="w-3 h-3" />
                        טעינת פרטים נוספים
                      </button>
                    )}
                    {enrichState === "loading" && (
                      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-blue-600 border border-blue-100 bg-blue-50 rounded-md">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        חיפוש ב-Apollo…
                      </div>
                    )}
                    {enrichState === "done" && (
                      <p className="text-xs text-[#9b9895] px-1">לא נמצאו נתוני קשר ב-Apollo.</p>
                    )}
                    {enrichState === "error" && (
                      <div className="space-y-1">
                        <p className="text-xs text-red-500 px-1">{enrichError}</p>
                        <button
                          onClick={handleEnrich}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6b6866] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all"
                        >
                          <Zap className="w-3 h-3" />
                          נסה שוב
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {enrichState === "done" && (localContact.email || localContact.phone) && (
                  <div className="flex items-center gap-1.5 mt-1 px-1 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" />
                    הועשר בהצלחה
                  </div>
                )}

                {/* Enrich button for contacts that already have some data */}
                {(localContact.email || localContact.phone) && enrichState === "idle" && (
                  <button
                    onClick={handleEnrich}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#9b9895] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />
                    העשר שוב
                  </button>
                )}
              </div>

              {/* Professional info */}
              <div className="p-4 space-y-3 border-b border-[#e5e3df]">
                <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                  מקצועי
                </p>
                <div className="space-y-3">
                  {localContact.currentCompany && (
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">חברה</p>
                        <p className="text-sm text-[#111110] truncate">{localContact.currentCompany}</p>
                      </div>
                    </div>
                  )}
                  {(() => {
                    const { value: empCount, source: empSource } = displayCompanySize(localContact);
                    if (!empCount) return null;
                    return (
                      <div className="flex items-center gap-2.5">
                        <Users className="w-4 h-4 text-[#9b9895] shrink-0" />
                        <div>
                          <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">עובדים</p>
                          <p className="text-sm font-mono text-[#111110]">
                            {empCount.toLocaleString()}
                            <span className="ml-1.5 text-[10px] text-[#9b9895] font-sans">
                              (מ-{empSource === "apollo" ? "Apollo" : "LinkedIn"})
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  {localContact.location && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">מיקום</p>
                        <p className="text-sm text-[#111110]">{localContact.location}</p>
                      </div>
                    </div>
                  )}
                  {localContact.industry && (
                    <div>
                      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-0.5">ענף</p>
                      <p className="text-sm text-[#111110]">{localContact.industry}</p>
                    </div>
                  )}
                  {localContact.lastSyncedAt && (
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-4 h-4 text-[#9b9895] shrink-0" />
                      <div>
                        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">סינכרון אחרון</p>
                        <p className="text-xs font-mono text-[#9b9895]">
                          {formatDate(localContact.lastSyncedAt)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {localContact.linkedinUrl && localContact.linkedinUrl.includes("/in/") && localContact.linkedinUrl.split("/in/")[1] && (
                  <a
                    href={localContact.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 mt-2 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    צפה ב-LinkedIn
                  </a>
                )}
              </div>

              {/* Enrichment Details (collapsed by default) */}
              {localContact.enrichmentRanAt && (
                <div className="border-b border-[#e5e3df]">
                  <button
                    onClick={() => setShowEnrichDetails((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#f8f7f5] transition-colors"
                  >
                    <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">
                      פרטי העשרה
                    </p>
                    {showEnrichDetails ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#9b9895]" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#9b9895]" />
                    )}
                  </button>

                  {showEnrichDetails && (
                    <div className="px-4 pb-4 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[#9b9895]">
                          ניסיון אחרון: {formatDateTime(localContact.enrichmentRanAt)}
                        </span>
                        {localContact.enrichmentSource && (
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
                              localContact.enrichmentSource === "apollo"
                                ? "bg-blue-50 text-blue-600 border border-blue-200"
                                : "bg-violet-50 text-violet-600 border border-violet-200"
                            )}
                          >
                            {localContact.enrichmentSource === "apollo" ? "Apollo (חדש)" : "זיכרון מטמון"}
                          </span>
                        )}
                      </div>

                      {localContact.enrichmentError && (
                        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-red-600 leading-snug">{localContact.enrichmentError}</p>
                        </div>
                      )}

                      {!!localContact.enrichmentLog && (
                        <div>
                          <button
                            onClick={() => setShowRawLog((v) => !v)}
                            className="flex items-center gap-1 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                          >
                            {showRawLog ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            הצג תגובת Apollo גולמית
                          </button>
                          {showRawLog && (
                            <pre className="mt-2 p-2.5 rounded-md bg-[#f8f7f5] border border-[#e5e3df] text-[10px] text-[#6b6866] overflow-x-auto max-h-64 leading-relaxed">
                              {JSON.stringify(localContact.enrichmentLog, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Lists */}
              <div className="p-4 border-b border-[#e5e3df]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">רשימות</p>
                  <div className="relative">
                    <button
                      ref={addListBtnRef}
                      onClick={() => setShowListPopover((v) => !v)}
                      className="flex items-center gap-1 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      הוסף
                    </button>
                    {showListPopover && localContact && (
                      <ListPopover
                        placement="down"
                        contactIds={[localContact.id]}
                        onClose={() => {
                          setShowListPopover(false);
                          fetch(`/api/lists?contactId=${localContact.id}`)
                            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
                            .then((d) => setContactLists(d.lists ?? []))
                            .catch(() => {});
                        }}
                        anchorRef={addListBtnRef as React.RefObject<HTMLElement>}
                      />
                    )}
                  </div>
                </div>
                {contactLists.length === 0 ? (
                  <p className="text-xs text-[#9b9895]">לא כלול ברשימה כלשהי</p>
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
                              body: JSON.stringify({ remove: [localContact!.id] }),
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
                  היסטוריית הודעות
                </p>
                {loadingMessages ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-lg bg-[#f3f2ef] animate-pulse" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-[#9b9895]">לא נשלחו הודעות עדיין.</p>
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
                            {msg.status === "SENT" ? "נשלח" : msg.status === "QUEUED" ? "בתור" : msg.status}
                          </span>
                        </div>
                        <p className="text-xs text-[#111110] leading-relaxed line-clamp-3">{msg.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {showEdit && localContact && (
              <EditContactModal
                contact={localContact}
                onClose={() => setShowEdit(false)}
                onSaved={(updated) => {
                  setLocalContact(updated);
                  setShowEdit(false);
                  onSaved?.(updated);
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
