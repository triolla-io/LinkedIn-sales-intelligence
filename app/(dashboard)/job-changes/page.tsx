"use client";

import { useReducer, useState } from "react";
import { Button, Chip, TextArea } from "@heroui/react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
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

type State = { changes: Change[]; loading: boolean };

export default function JobChangesPage() {
  const [state, dispatch] = useReducer(
    (s: State, a: Partial<State>) => ({ ...s, ...a }),
    { changes: [], loading: true }
  );

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

  const pending = state.changes.filter((c) => c.status === "PENDING_REVIEW");
  const rest = state.changes.filter((c) => c.status !== "PENDING_REVIEW");

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <PartyPopper className="w-5 h-5 text-[#c2410c]" />
        <h1 className="text-lg font-semibold">עדכוני תפקיד</h1>
        {pending.length > 0 && (
          <Chip size="sm" color="warning">{pending.length} ממתינים לאישור</Chip>
        )}
      </div>

      <div className="flex-1 p-5">
        {state.loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> טוען…
          </div>
        ) : state.changes.length === 0 ? (
          <p className="text-gray-500">אין עדכוני תפקיד חדשים. נבדוק שוב בקרוב.</p>
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
    <li className="bg-white rounded-lg border border-[#e5e3df] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={c.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#0a66c2] inline-flex items-center gap-1"
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
              נשלח {c.sentAt ? new Date(c.sentAt).toLocaleDateString("he-IL") : ""}
            </Chip>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {new Date(c.detectedAt).toLocaleDateString("he-IL")}
        </span>
      </div>

      <div className="mt-1 text-sm text-gray-700">
        {c.prevTitle !== c.newTitle && (
          <div>
            תפקיד: <span className="line-through text-gray-400">{c.prevTitle ?? "—"}</span> ←{" "}
            <span className="font-medium">{c.newTitle ?? "—"}</span>
          </div>
        )}
        {c.prevCompany !== c.newCompany && (
          <div>
            חברה: <span className="line-through text-gray-400">{c.prevCompany ?? "—"}</span> ←{" "}
            <span className="font-medium">{c.newCompany ?? "—"}</span>
          </div>
        )}
      </div>

      {c.status === "PENDING_REVIEW" && (
        <div className="mt-3 flex flex-col gap-2">
          {c.lastSendError && (
            <p className="text-xs text-red-600">השליחה הקודמת נכשלה: {c.lastSendError}</p>
          )}
          {actionError && (
            <p className="text-xs text-red-600">{actionError}</p>
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
        <p className="mt-3 text-sm bg-[#f6f5f3] rounded p-2 whitespace-pre-wrap">{c.draftMessage}</p>
      )}
    </li>
  );
}
