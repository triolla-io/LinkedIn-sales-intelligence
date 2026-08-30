"use client";

import { Suspense, useReducer, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Chip, TextArea } from "@heroui/react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { parseFeedFilter, matchesFilter } from "@/lib/job-check/feed-filter";
import { PartyPopper, Loader2, ExternalLink } from "lucide-react";

type Change = {
  id: string;
  contactId: string;
  fullName: string;
  linkedinUrl: string;
  prevTitle: string | null;
  newTitle: string | null;
  prevCompany: string | null;
  newCompany: string | null;
  detectedAt: string;
  status: "PENDING_REVIEW" | "APPROVED" | "SENT";
  changeType: "COMPANY_MOVE" | "PROMOTION" | "TITLE_CHANGE" | null;
  draftMessage: string | null;
  sentAt: string | null;
  lastSendError: string | null;
};

const CHANGE_TYPE_LABEL: Record<NonNullable<Change["changeType"]>, string> = {
  COMPANY_MOVE: "מעבר חברה",
  PROMOTION: "קידום",
  TITLE_CHANGE: "שינוי תפקיד",
};

const FILTER_LABEL: Record<string, string> = {
  all: "עדכוני משתמשים",
  company: "החליפו חברה",
  role: "החליפו תפקיד",
  pending: "ממתין לשליחה",
};

type State = { changes: Change[]; loading: boolean };

function JobChangesFeed() {
  const [state, dispatch] = useReducer(
    (s: State, a: Partial<State>) => ({ ...s, ...a }),
    { changes: [], loading: true }
  );

  const { modules, setModule } = useRoutineModules();
  const jobChecksOn = modules?.jobChecksEnabled ?? false;

  async function fetchChanges() {
    try {
      const res = await fetch("/api/job-changes");
      if (res.ok) {
        const data = await res.json();
        dispatch({ changes: data.changes ?? [] });
      }
    } finally {
      dispatch({ loading: false });
    }
  }

  useAutoRefresh(fetchChanges, 30_000);

  const searchParams = useSearchParams();
  const filter = parseFeedFilter(searchParams.get("filter"));
  const visible = state.changes.filter((c) => matchesFilter(c, filter));
  const pending = visible.filter((c) => c.status === "PENDING_REVIEW");
  const rest = visible.filter((c) => c.status !== "PENDING_REVIEW");

  return (
    <div className="flex flex-col h-full min-h-screen bg-[var(--background)]" dir="rtl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-surface sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <PartyPopper className="w-5 h-5 text-[var(--warning)]" />
          <h1 className="text-lg font-semibold">{FILTER_LABEL[filter]}</h1>
          {pending.length > 0 && (
            <Chip size="sm" color="warning">{pending.length} ממתינים לאישור</Chip>
          )}
        </div>
        {modules && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${jobChecksOn ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
              {jobChecksOn ? "המודול פעיל" : "המודול כבוי"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={jobChecksOn}
              aria-label="הפעלת מודול עדכוני משתמשים"
              onClick={() => setModule("jobChecks", !jobChecksOn)}
              dir="ltr"
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${jobChecksOn ? "bg-[var(--success)]" : "bg-[var(--faint)]"}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform ${jobChecksOn ? "translate-x-[22px]" : "translate-x-[2px]"}`}
              />
            </button>
          </div>
        )}
      </div>

      {modules && !jobChecksOn && (
        <div className="px-5 py-2.5 bg-[var(--warning-soft)] border-b border-[var(--warning-soft)] text-xs text-[var(--warning)]">
          הבדיקה האוטומטית מושבתת זמנית לתחזוקה. ההעדפה נשמרת ותוחל כשהבדיקות יחזרו לפעול.
        </div>
      )}

      <div className="flex-1 p-5">
        {state.loading ? (
          <div className="flex items-center gap-2 text-[var(--muted)]">
            <Loader2 className="w-4 h-4 animate-spin" /> טוען…
          </div>
        ) : visible.length === 0 ? (
          <p className="text-[var(--muted)]">אין עדכוני משתמשים חדשים. נבדוק שוב בקרוב.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...pending, ...rest].map((c) => (
              <ChangeCard key={c.id} change={c} onDone={fetchChanges} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function JobChangesFeedPage() {
  return (
    <Suspense fallback={null}>
      <JobChangesFeed />
    </Suspense>
  );
}

function ChangeCard({ change: c, onDone }: { change: Change; onDone: () => void }) {
  const [message, setMessage] = useState(c.draftMessage ?? "");
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: "approve" | "dismiss") {
    setBusy(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/job-changes/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, message } : { action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? "שגיאה בשליחה, נסה שוב");
        return;
      }
      onDone();
    } catch {
      setActionError("שגיאת רשת, נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="bg-surface rounded-lg border border-[var(--line)] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={c.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[var(--brand-linkedin)] inline-flex items-center gap-1"
          >
            {c.fullName} <ExternalLink className="w-3 h-3" />
          </a>
          {c.changeType && (
            <Chip size="sm" color={c.changeType === "COMPANY_MOVE" ? "danger" : "success"}>
              {CHANGE_TYPE_LABEL[c.changeType]}
            </Chip>
          )}
          {c.status === "APPROVED" && <Chip size="sm" color="default">בתור לשליחה…</Chip>}
          {c.status === "SENT" && (
            <Chip size="sm" color="success">
              נשלח {c.sentAt ? new Date(c.sentAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : ""}
            </Chip>
          )}
        </div>
        <span className="text-xs text-[var(--faint)]">
          {new Date(c.detectedAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}
        </span>
      </div>

      <div className="mt-1 text-sm text-[var(--muted)]">
        {c.prevTitle !== c.newTitle && (
          <div>
            תפקיד: <span className="line-through text-[var(--faint)]">{c.prevTitle ?? "—"}</span> ←{" "}
            <span className="font-medium">{c.newTitle ?? "—"}</span>
          </div>
        )}
        {c.prevCompany !== c.newCompany && (
          <div>
            חברה: <span className="line-through text-[var(--faint)]">{c.prevCompany ?? "—"}</span> ←{" "}
            <span className="font-medium">{c.newCompany ?? "—"}</span>
          </div>
        )}
      </div>

      {c.status === "PENDING_REVIEW" && (
        <div className="mt-3 flex flex-col gap-2">
          {c.lastSendError && (
            <p className="text-xs text-[var(--danger)]">השליחה הקודמת נכשלה: {c.lastSendError}</p>
          )}
          {actionError && (
            <p className="text-xs text-[var(--danger)]">{actionError}</p>
          )}
          <TextArea
            aria-label="הודעת ברכה"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              isDisabled={!message.trim() || busy !== null}
              onPress={() => act("approve")}
            >
              <span className="inline-flex items-center gap-1">
                {busy === "approve" && <Loader2 className="w-3 h-3 animate-spin" />}
                אשר ושלח בלינקדאין
              </span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy !== null}
              onPress={() => act("dismiss")}
            >
              <span className="inline-flex items-center gap-1">
                {busy === "dismiss" && <Loader2 className="w-3 h-3 animate-spin" />}
                דחה
              </span>
            </Button>
          </div>
        </div>
      )}
      {c.status !== "PENDING_REVIEW" && c.draftMessage && (
        <p className="mt-3 text-sm bg-[var(--background)] rounded p-2 whitespace-pre-wrap">{c.draftMessage}</p>
      )}
    </li>
  );
}
