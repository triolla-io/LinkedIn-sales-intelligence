"use client";

import { useReducer, useState } from "react";
import { Button, Chip, TextArea, Switch, Tabs } from "@heroui/react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { Sparkles, Loader2, ExternalLink, Building2, CalendarDays, Copy, Check } from "lucide-react";
import { resolveEventDate, formatEventDate } from "@/lib/company-signals/event-date";
import { gmailComposeHref } from "@/lib/channels/gmail-compose";

type Source = { name: string; url: string; publishedAt: string | null };
type Draft = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "PREPARED";
  channel: string;
  draftMessage: string;
  emailSubject: string | null;
  emailBody: string | null;
  whatsappMessage: string | null;
  createdAt: string;
  contact: {
    fullName: string;
    currentTitle: string | null;
    linkedinUrl: string;
    email: string | null;
    phone: string | null;
  };
  signal: {
    signalType: string;
    title: string;
    summary: string;
    confidence: number;
    sources: Source[];
    eventDate: string | null;
    company: { name: string };
  };
};

const TYPE_LABEL: Record<string, string> = {
  FUNDING: "גיוס", HIRING_GROWTH: "צמיחת כוח אדם", OFFICE_MOVE: "מעבר משרד",
  PRODUCT_LAUNCH: "השקת מוצר", AWARD: "פרס", MILESTONE: "אבן דרך", EXEC_HIRE: "מינוי בכיר",
};

function hostLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

type State = { drafts: Draft[]; loading: boolean };

export default function CompanySignalsPage() {
  const [state, dispatch] = useReducer(
    (s: State, a: Partial<State>) => ({ ...s, ...a }),
    { drafts: [], loading: true }
  );

  const { modules, setModule } = useRoutineModules();
  const signalsOn = modules?.companySignalsEnabled ?? false;

  async function fetchDrafts() {
    try {
      const res = await fetch("/api/company-signals");
      if (res.ok) {
        const data = await res.json();
        dispatch({ drafts: data.drafts ?? [] });
      }
    } finally {
      dispatch({ loading: false });
    }
  }

  useAutoRefresh(fetchDrafts, 30_000);

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#c2410c]" />
          <h1 className="text-lg font-semibold">חדשות חברות — סקירה</h1>
          {state.drafts.length > 0 && (
            <Chip size="sm" color="warning">{state.drafts.length} ממתינים לסקירה</Chip>
          )}
        </div>
        {modules && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${signalsOn ? "text-[#059669]" : "text-[#b45309]"}`}>
              {signalsOn ? "המודול פעיל" : "המודול כבוי"}
            </span>
            <Switch
              size="sm"
              isSelected={signalsOn}
              onChange={(v: boolean) => setModule("companySignals", v)}
              aria-label="הפעלת מודול חדשות חברות"
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </div>
        )}
      </div>

      {modules && !signalsOn && (
        <div className="px-5 py-2.5 bg-[#fffbeb] border-b border-[#fde68a] text-xs text-[#b45309]">
          זיהוי החדשות האוטומטי מושבת. ההעדפה נשמרת ותוחל כשהמודול יופעל.
        </div>
      )}

      <div className="flex-1 p-5">
        {state.loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> טוען…
          </div>
        ) : state.drafts.length === 0 ? (
          <p className="text-gray-500">אין טיוטות ממתינות לסקירה.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {state.drafts.map((d) => (
              <DraftCard key={d.id} draft={d} onDone={fetchDrafts} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const ACTION_ERROR_LABEL: Record<string, string> = {
  no_email: "אין כתובת אימייל לאיש הקשר",
  no_linkedin_url: "אין כתובת לינקדאין לאיש הקשר",
  not_pending: "הטיוטה כבר בטיפול — רענן את העמוד",
  not_prepared: "הטיוטה עדיין לא הוכנה — רענן את העמוד",
};

function DraftCard({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [text, setText] = useState(draft.draftMessage);
  const [emailSubject, setEmailSubject] = useState(draft.emailSubject ?? "");
  const [emailBody, setEmailBody] = useState(draft.emailBody ?? "");
  const [busy, setBusy] = useState<"prepare" | "prepared" | "sent" | "dismiss" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(payload: Record<string, string>, busyKey: "prepare" | "prepared" | "sent" | "dismiss") {
    setBusy(busyKey);
    setActionError(null);
    try {
      const res = await fetch(`/api/company-signals/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(ACTION_ERROR_LABEL[data.error as string] ?? data.error ?? "שגיאה, נסה שוב");
        return;
      }
      onDone();
    } catch {
      setActionError("שגיאת רשת, נסה שוב");
    } finally {
      setBusy(null);
    }
  }

  // Email prepare: open a pre-filled Gmail compose window (nothing is sent until the
  // user clicks Send there), then record the draft as PREPARED.
  function prepareEmail() {
    if (!draft.contact.email) return;
    window.open(gmailComposeHref(draft.contact.email, emailBody, emailSubject), "_blank", "noopener,noreferrer");
    void act({ action: "prepared", channel: "email", subject: emailSubject, message: emailBody }, "prepared");
  }

  const pct = Math.round(draft.signal.confidence * 100);
  const newsDate = formatEventDate(resolveEventDate(draft.signal.eventDate, draft.signal.sources));

  return (
    <li className="bg-white rounded-lg border border-[#e5e3df] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="font-semibold">{draft.signal.company.name}</span>
        <Chip size="sm" color="warning">
          {TYPE_LABEL[draft.signal.signalType] ?? draft.signal.signalType}
        </Chip>
        <span className="text-xs text-gray-500">ביטחון {pct}%</span>
        {newsDate && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <CalendarDays className="w-3 h-3" /> {newsDate}
          </span>
        )}
        <span className="text-sm text-gray-700">· {draft.signal.title}</span>
      </div>

      <div className="text-sm text-gray-600">{draft.signal.summary}</div>

      {draft.signal.sources.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {draft.signal.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-[#c2410c] hover:underline">
              <ExternalLink className="w-3 h-3" /> {s.name || hostLabel(s.url)}
            </a>
          ))}
        </div>
      )}

      <div className="text-sm text-gray-700">
        אל:{" "}
        <a
          href={draft.contact.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#1585ff] hover:underline"
        >
          {draft.contact.fullName}
        </a>
        {draft.contact.currentTitle ? ` · ${draft.contact.currentTitle}` : ""}
      </div>

      {draft.status !== "PENDING_REVIEW" ? (
        <PrepareStatePanel draft={draft} busy={busy} actionError={actionError} onSent={() => act({ action: "sent" }, "sent")} onDismiss={() => act({ action: "dismiss" }, "dismiss")} />
      ) : (
      <Tabs defaultSelectedKey="linkedin" className="w-full">
        <Tabs.ListContainer>
          <Tabs.List aria-label="ערוץ הודעה">
            <Tabs.Tab id="linkedin">
              לינקדאין
              <Tabs.Indicator />
            </Tabs.Tab>
            {/* A channel tab is offered only when we can actually reach the contact there. */}
            {draft.emailBody && draft.contact.email && (
              <Tabs.Tab id="email">
                אימייל
                <Tabs.Indicator />
              </Tabs.Tab>
            )}
            {draft.whatsappMessage && draft.contact.phone && (
              <Tabs.Tab id="whatsapp">
                וואטסאפ
                <Tabs.Indicator />
              </Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="linkedin" className="pt-3">
          <div className="flex flex-col gap-2">
            {actionError && <p className="text-xs text-red-600">{actionError}</p>}
            <TextArea
              aria-label="טיוטת הודעה"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full"
              dir="rtl"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="primary"
                isDisabled={!text.trim() || busy !== null}
                onPress={() => act({ action: "prepare", message: text }, "prepare")}
              >
                <span className="inline-flex items-center gap-1">
                  {busy === "prepare" && <Loader2 className="w-3 h-3 animate-spin" />}
                  הכן בלינקדאין
                </span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={busy !== null}
                onPress={() => act({ action: "dismiss" }, "dismiss")}
              >
                <span className="inline-flex items-center gap-1">
                  {busy === "dismiss" && <Loader2 className="w-3 h-3 animate-spin" />}
                  דחה
                </span>
              </Button>
              <span className="text-xs text-gray-500">
                ההודעה תוקלד בלינקדאין וייפתח לך טאב מוכן — השליחה עצמה בידיים שלך
              </span>
            </div>
          </div>
        </Tabs.Panel>

        {draft.emailBody && draft.contact.email && (
          <Tabs.Panel id="email" className="pt-3">
            <div className="flex flex-col gap-2">
              {actionError && <p className="text-xs text-red-600">{actionError}</p>}
              <TextArea
                aria-label="נושא האימייל"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full"
                dir="rtl"
              />
              <TextArea
                aria-label="גוף האימייל"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full"
                dir="rtl"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={!emailBody.trim() || !emailSubject.trim() || busy !== null}
                  onPress={prepareEmail}
                >
                  <span className="inline-flex items-center gap-1">
                    {busy === "prepared" && <Loader2 className="w-3 h-3 animate-spin" />}
                    פתח טיוטה ב-Gmail
                  </span>
                </Button>
                <span className="text-xs text-gray-500">
                  ייפתח חלון כתיבה ב-Gmail אל {draft.contact.email} — השליחה בידיים שלך
                </span>
              </div>
            </div>
          </Tabs.Panel>
        )}

        {draft.whatsappMessage && (
          <Tabs.Panel id="whatsapp" className="pt-3">
            <CopyBlock label="הודעת וואטסאפ" text={draft.whatsappMessage}>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{draft.whatsappMessage}</p>
            </CopyBlock>
          </Tabs.Panel>
        )}
      </Tabs>
      )}
    </li>
  );
}

/** APPROVED = a prepare task is queued/running; PREPARED = the draft is typed and open,
 * waiting for the user to click Send and confirm here. Nothing auto-sends. */
function PrepareStatePanel({
  draft, busy, actionError, onSent, onDismiss,
}: {
  draft: Draft;
  busy: string | null;
  actionError: string | null;
  onSent: () => void;
  onDismiss: () => void;
}) {
  const isEmail = draft.channel === "EMAIL";
  const message = isEmail ? (draft.emailBody ?? "") : draft.draftMessage;

  return (
    <div className="flex flex-col gap-2">
      {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      <div className="bg-[#f6f5f3] rounded-md border border-[#e5e3df] p-3">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{message}</p>
      </div>
      {draft.status === "APPROVED" ? (
        <div className="flex items-center gap-2 text-sm text-[#b45309]">
          <Loader2 className="w-4 h-4 animate-spin" />
          ההודעה בהכנה — טאב לינקדאין עם ההודעה מוקלדת ייפתח אצלך עוד רגע (ודא שהתוסף פעיל)
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-[#059669]">
          <Check className="w-4 h-4" />
          {isEmail
            ? "הטיוטה נפתחה בחלון Gmail — בדוק, לחץ שליחה שם, וחזור לאשר כאן"
            : "ההודעה מוקלדת ומחכה בטאב הלינקדאין שנפתח — לחץ שם שליחה וחזור לאשר כאן"}
        </div>
      )}
      <div className="flex gap-2">
        {draft.status === "PREPARED" && (
          <Button size="sm" variant="primary" isDisabled={busy !== null} onPress={onSent}>
            <span className="inline-flex items-center gap-1">
              {busy === "sent" && <Loader2 className="w-3 h-3 animate-spin" />}
              שלחתי ✓
            </span>
          </Button>
        )}
        <Button size="sm" variant="ghost" isDisabled={busy !== null} onPress={onDismiss}>
          <span className="inline-flex items-center gap-1">
            {busy === "dismiss" && <Loader2 className="w-3 h-3 animate-spin" />}
            דחה
          </span>
        </Button>
      </div>
    </div>
  );
}

function CopyBlock({ label, text, children }: { label: string; text: string; children: React.ReactNode }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState(() => "idle"), 2000);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-[#f6f5f3] rounded-md border border-[#e5e3df] p-3 flex flex-col gap-1">
        {children}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onPress={copy} aria-label={`העתקת ${label}`}>
          <span className="inline-flex items-center gap-1">
            {state === "copied" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {state === "copied" ? "הועתק" : "העתק"}
          </span>
        </Button>
        {state === "error" && <span className="text-xs text-red-600">ההעתקה נכשלה — סמן והעתק ידנית</span>}
      </div>
    </div>
  );
}
