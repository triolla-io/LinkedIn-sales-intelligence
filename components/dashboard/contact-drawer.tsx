"use client";

import { useEffect, useEffectEvent, useRef, useReducer, useState, type RefObject } from "react";
import useSWR from "swr";
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
import { enrichmentProgress } from "@/lib/enrichment-progress";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit",
});

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ContactMessagesSection({
  messages,
  loading,
}: {
  messages: MessageRecord[];
  loading: boolean;
}) {
  return (
    <div className="p-4">
      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest mb-3">
        היסטוריית הודעות
      </p>
      {loading ? (
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
  );
}

function ContactListsSection({
  contactId,
  lists,
  showListPopover,
  onTogglePopover,
  onMutateLists,
  addListBtnRef,
}: {
  contactId: string;
  lists: { id: string; name: string }[];
  showListPopover: boolean;
  onTogglePopover: () => void;
  onMutateLists: () => void;
  addListBtnRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="p-4 border-b border-[#e5e3df]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">רשימות</p>
        <div className="relative">
          <button
            type="button"
            ref={addListBtnRef}
            onClick={onTogglePopover}
            className="flex items-center gap-1 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors"
          >
            <Plus className="size-3" />
            הוסף
          </button>
          {showListPopover && (
            <ListPopover
              placement="down"
              contactIds={[contactId]}
              onClose={() => {
                onTogglePopover();
                onMutateLists();
              }}
              anchorRef={addListBtnRef as RefObject<HTMLElement>}
            />
          )}
        </div>
      </div>
      {lists.length === 0 ? (
        <p className="text-xs text-[#9b9895]">לא כלול ברשימה כלשהי</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {lists.map((list) => (
            <span
              key={list.id}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1585ff]/10 border border-[#1585ff]/20 text-xs text-[#1585ff]"
            >
              {list.name}
              <button
                type="button"
                onClick={async () => {
                  await fetch(`/api/lists/${list.id}/members`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ remove: [contactId] }),
                  });
                  onMutateLists();
                }}
                className="hover:text-red-400 transition-colors"
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drawer state managed by useReducer ──────────────────────────────────────

type DrawerState = {
  showListPopover: boolean;
  showEdit: boolean;
  enrichState: "idle" | "loading" | "done" | "error";
  enrichError: string | null;
  mobilePending: boolean;
  showEnrichDetails: boolean;
  showRawLog: boolean;
  pendingPhone: string | null;
};

const initialDrawerState: DrawerState = {
  showListPopover: false,
  showEdit: false,
  enrichState: "idle",
  enrichError: null,
  mobilePending: false,
  showEnrichDetails: false,
  showRawLog: false,
  pendingPhone: null,
};

function drawerReducer(s: DrawerState, a: Partial<DrawerState>): DrawerState {
  return { ...s, ...a };
}

// ── Extracted sections ──────────────────────────────────────────────────────

function ContactInfoSection({
  localContact,
  displayPhone,
  mobilePending,
  enrichState,
  enrichError,
  onEdit,
  onEnrich,
}: {
  localContact: LocalContact;
  displayPhone: string | null | undefined;
  mobilePending: boolean;
  enrichState: DrawerState["enrichState"];
  enrichError: string | null;
  onEdit: () => void;
  onEnrich: () => void;
}) {
  return (
    <div className="p-4 space-y-4 border-b border-[#e5e3df]">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">פרטי קשר</p>
        <button type="button" onClick={onEdit} className="text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors">
          ערוך
        </button>
      </div>

      {localContact.email ? (
        <div className="flex items-center gap-2.5">
          <Mail className="size-4 text-[#1585ff] shrink-0" />
          <div>
            <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">אימייל</p>
            <a href={`mailto:${localContact.email}`} className="text-sm text-[#1585ff] hover:text-[#0a70e0] transition-colors font-mono">
              {localContact.email}
            </a>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 opacity-40">
          <Mail className="size-4 text-[#9b9895] shrink-0" />
          <p className="text-xs text-[#9b9895]">אין אימייל בנתונים</p>
        </div>
      )}

      {displayPhone ? (
        <div className="flex items-center gap-2.5">
          <Phone className="size-4 text-emerald-500 shrink-0" />
          <div>
            <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">טלפון</p>
            <a
              href={`tel:${displayPhone}`}
              className="text-sm text-[#111110] hover:text-black transition-colors font-mono"
              style={{ direction: "ltr", unicodeBidi: "isolate", display: "inline-block" }}
            >
              {displayPhone}
            </a>
          </div>
        </div>
      ) : mobilePending ? (
        <div className="flex items-center gap-2.5">
          <Phone className="size-4 text-amber-400 shrink-0" />
          <div>
            <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">טלפון</p>
            <p className="text-xs text-amber-500 font-mono">אימות טלפון נייד דרך webhook…</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 opacity-40">
          <Phone className="size-4 text-[#9b9895] shrink-0" />
          <p className="text-xs text-[#9b9895]">אין טלפון בנתונים</p>
        </div>
      )}

      {!localContact.email && !displayPhone && !mobilePending && (
        <div className="mt-1 space-y-1.5">
          {enrichState === "idle" && (
            <button type="button" onClick={onEnrich} className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6b6866] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all">
              <Zap className="size-3" />
              טעינת פרטים נוספים
            </button>
          )}
          {enrichState === "loading" && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-blue-600 border border-blue-100 bg-blue-50 rounded-md">
              <RefreshCw className="size-3 animate-spin" />
              חיפוש ב-Apollo…
            </div>
          )}
          {enrichState === "done" && <p className="text-xs text-[#9b9895] px-1">לא נמצאו נתוני קשר ב-Apollo.</p>}
          {enrichState === "error" && (
            <div className="space-y-1">
              <p className="text-xs text-red-500 px-1">{enrichError}</p>
              <button type="button" onClick={onEnrich} className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6b6866] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all">
                <Zap className="size-3" />
                נסה שוב
              </button>
            </div>
          )}
        </div>
      )}

      {enrichState === "done" && (localContact.email || displayPhone) && (
        <div className="flex items-center gap-1.5 mt-1 px-1 text-xs text-emerald-600">
          <CheckCircle2 className="size-3" />
          הועשר בהצלחה
        </div>
      )}

      {(localContact.email || displayPhone) && enrichState === "idle" && (
        <button type="button" onClick={onEnrich} className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#9b9895] border border-[#e5e3df] hover:border-amber-300 hover:text-amber-600 rounded-md transition-all">
          <RefreshCw className="size-3" />
          העשר שוב
        </button>
      )}
    </div>
  );
}

function ContactProfessionalSection({ localContact }: { localContact: LocalContact }) {
  return (
    <div className="p-4 space-y-3 border-b border-[#e5e3df]">
      <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">מקצועי</p>
      <div className="space-y-3">
        {localContact.currentCompany && (
          <div className="flex items-center gap-2.5">
            <Building2 className="size-4 text-[#9b9895] shrink-0" />
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
              <Users className="size-4 text-[#9b9895] shrink-0" />
              <div>
                <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">עובדים</p>
                <p className="text-sm font-mono text-[#111110]">
                  {empCount.toLocaleString()}
                  <span className="ml-1.5 text-[10px] text-[#9b9895] font-sans">(מ-{empSource === "apollo" ? "Apollo" : "LinkedIn"})</span>
                </p>
              </div>
            </div>
          );
        })()}
        {localContact.location && (
          <div className="flex items-center gap-2.5">
            <MapPin className="size-4 text-[#9b9895] shrink-0" />
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
        {localContact.connectedAt && (
          <div className="flex items-center gap-2.5">
            <Clock className="size-4 text-[#9b9895] shrink-0" />
            <div>
              <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">התחברות ב-LinkedIn</p>
              <p className="text-xs font-mono text-[#9b9895]">{formatDate(localContact.connectedAt)}</p>
            </div>
          </div>
        )}
        {localContact.lastSyncedAt && (
          <div className="flex items-center gap-2.5">
            <Clock className="size-4 text-[#9b9895] shrink-0" />
            <div>
              <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">סינכרון אחרון</p>
              <p className="text-xs font-mono text-[#9b9895]">{formatDate(localContact.lastSyncedAt)}</p>
            </div>
          </div>
        )}
      </div>
      {localContact.linkedinUrl && localContact.linkedinUrl.includes("/in/") && localContact.linkedinUrl.split("/in/")[1] && (
        <a href={localContact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 mt-2 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors">
          <ExternalLink className="size-3.5" />
          צפה ב-LinkedIn
        </a>
      )}
    </div>
  );
}

function ContactEnrichmentDetails({
  localContact,
  showEnrichDetails,
  showRawLog,
  onToggleDetails,
  onToggleLog,
}: {
  localContact: LocalContact;
  showEnrichDetails: boolean;
  showRawLog: boolean;
  onToggleDetails: () => void;
  onToggleLog: () => void;
}) {
  return (
    <div className="border-b border-[#e5e3df]">
      <button type="button" onClick={onToggleDetails} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#f8f7f5] transition-colors">
        <p className="text-[10px] font-mono text-[#9b9895] uppercase tracking-widest">פרטי העשרה</p>
        {showEnrichDetails ? <ChevronDown className="size-3.5 text-[#9b9895]" /> : <ChevronRight className="size-3.5 text-[#9b9895]" />}
      </button>
      {showEnrichDetails && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#9b9895]">ניסיון אחרון: {formatDateTime(localContact.enrichmentRanAt!)}</span>
            {localContact.enrichmentSource && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
                localContact.enrichmentSource === "apollo"
                  ? "bg-blue-50 text-blue-600 border border-blue-200"
                  : "bg-violet-50 text-violet-600 border border-violet-200"
              )}>
                {localContact.enrichmentSource === "apollo" ? "Apollo (חדש)" : "זיכרון מטמון"}
              </span>
            )}
          </div>
          {localContact.enrichmentError && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200">
              <AlertTriangle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 leading-snug">{localContact.enrichmentError}</p>
            </div>
          )}
          {!!localContact.enrichmentLog && (
            <div>
              <button type="button" onClick={onToggleLog} className="flex items-center gap-1 text-xs text-[#9b9895] hover:text-[#1585ff] transition-colors">
                {showRawLog ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
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
  );
}

// ────────────────────────────────────────────────────────────────────────────

export default function ContactDrawer({ contact, onClose, onEnrich, onSaved }: ContactDrawerProps) {
  const [drawerState, dispatch] = useReducer(drawerReducer, initialDrawerState);
  const {
    showListPopover,
    showEdit,
    enrichState,
    enrichError,
    mobilePending,
    showEnrichDetails,
    showRawLog,
    pendingPhone,
  } = drawerState;

  // localContact holds the enriched/edited version of the contact (diverges from
  // the prop via handleEnrich, mobilePoll updates, and EditContactModal saves).
  // Initialized directly from the prop; re-synced when the prop's id changes via
  // the prevContactIdRef guard below.
  const [localContact, setLocalContact] = useState<LocalContact | null>(null);

  const addListBtnRef = useRef<HTMLButtonElement>(null);
  const pollAttemptsRef = useRef(0);
  const capturedPhoneRef = useRef<string | null | undefined>(undefined);

  // Inline state adjustment when contact changes (avoids adjusting state in useEffect)
  // Uses a ref to avoid triggering re-renders just for tracking the previous id.
  // Starts as undefined so first render always syncs localContact from the prop.
  const prevContactIdRef = useRef<string | null>(null);
  const incomingId = contact?.id ?? null;
  if (prevContactIdRef.current !== incomingId) {
    prevContactIdRef.current = incomingId;
    setLocalContact(contact);
    dispatch({
      showEdit: false,
      enrichState: "idle",
      enrichError: null,
      mobilePending: false,
      showEnrichDetails: false,
      showRawLog: false,
      pendingPhone: null,
    });
  }

  // SWR-based polling — no fetch() in the effect, just data watching
  const { data: pollData } = useSWR(
    mobilePending && localContact ? `/api/contacts/${localContact.id}` : null,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : null),
    { refreshInterval: 30_000, revalidateOnFocus: false, revalidateOnMount: false }
  );

  useEffect(() => {
    if (!pollData || !mobilePending) return;
    pollAttemptsRef.current += 1;
    if (pollData.phone && pollData.phone !== capturedPhoneRef.current) {
      dispatch({ mobilePending: false, pendingPhone: pollData.phone });
      toast.success(`${pollData.fullName} · Mobile phone received`, "Webhook delivered the mobile number.");
    } else if (pollAttemptsRef.current >= 10) {
      dispatch({ mobilePending: false });
    }
  }, [pollData, mobilePending]);

  async function handleEnrich() {
    if (!localContact) return;
    dispatch({ enrichState: "loading", enrichError: null });
    enrichmentProgress.start({ kind: "single", label: `מעשיר את ${localContact.fullName}`, total: 1 });

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
        dispatch({ enrichError: msg, enrichState: "error" });
        toast.error("Enrichment failed", msg);
        enrichmentProgress.finish();
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

      dispatch({ enrichState: "done" });
      enrichmentProgress.finish({ processed: 1, emails: data.email ? 1 : 0, phones: data.phone ? 1 : 0 });
      onEnrich(localContact.id);

      if (data.mobilePending) {
        pollAttemptsRef.current = 0;
        capturedPhoneRef.current = localContact?.phone ?? null;
        dispatch({ mobilePending: true });
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
      dispatch({ enrichError: "Network error", enrichState: "error" });
      toast.error("Enrichment failed", "Network error — check your connection.");
      enrichmentProgress.finish();
    }
  }

  const contactId = contact?.id ?? null;

  const { data: contactData, isLoading: loadingContactData } = useSWR(
    contactId ? `/api/contacts/${contactId}` : null,
    fetcher
  );
  const { data: listsData, mutate: mutateLists } = useSWR(
    contactId ? `/api/lists?contactId=${contactId}` : null,
    fetcher
  );

  const swrMessages: MessageRecord[] = contactData?.messages ?? [];
  const swrContactLists: { id: string; name: string }[] = listsData?.lists ?? [];

  const displayPhone = pendingPhone ?? localContact?.phone;

  const handleKeydown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (showEdit) return;
      onClose();
    }
  });

  useEffect(() => {
    if (!contact) return;
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [contact]);

  const visible = !!contact;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close drawer"
        className={cn(
          "fixed inset-0 bg-black/20 z-30 transition-opacity duration-200 cursor-default",
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
                type="button"
                onClick={onClose}
                className="text-[#9b9895] hover:text-[#6b6866] transition-colors shrink-0 mt-0.5"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              <ContactInfoSection
                localContact={localContact}
                displayPhone={displayPhone}
                mobilePending={mobilePending}
                enrichState={enrichState}
                enrichError={enrichError}
                onEdit={() => dispatch({ showEdit: true })}
                onEnrich={handleEnrich}
              />

              <ContactProfessionalSection localContact={localContact} />

              {localContact.enrichmentRanAt && (
                <ContactEnrichmentDetails
                  localContact={localContact}
                  showEnrichDetails={showEnrichDetails}
                  showRawLog={showRawLog}
                  onToggleDetails={() => dispatch({ showEnrichDetails: !showEnrichDetails })}
                  onToggleLog={() => dispatch({ showRawLog: !showRawLog })}
                />
              )}

              {/* Lists */}
              <ContactListsSection
                contactId={localContact.id}
                lists={swrContactLists}
                showListPopover={showListPopover}
                onTogglePopover={() => dispatch({ showListPopover: !showListPopover })}
                onMutateLists={mutateLists}
                addListBtnRef={addListBtnRef}
              />

              {/* Message history */}
              <ContactMessagesSection
                messages={swrMessages}
                loading={loadingContactData}
              />
            </div>

            {showEdit && localContact && (
              <EditContactModal
                contact={localContact}
                onClose={() => dispatch({ showEdit: false })}
                onSaved={(updated) => {
                  setLocalContact(updated);
                  dispatch({ showEdit: false, pendingPhone: null });
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
