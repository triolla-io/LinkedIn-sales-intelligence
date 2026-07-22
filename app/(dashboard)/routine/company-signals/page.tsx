"use client";

import { useReducer, useState } from "react";
import { Button, Chip, TextArea, Switch } from "@heroui/react";
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";
import { Sparkles, Loader2, ExternalLink, Building2 } from "lucide-react";

type Source = { name: string; url: string; publishedAt: string | null };
type Draft = {
  id: string;
  draftMessage: string;
  createdAt: string;
  contact: { fullName: string; currentTitle: string | null; linkedinUrl: string };
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

function DraftCard({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [text, setText] = useState(draft.draftMessage);
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: "approve" | "dismiss") {
    setBusy(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/company-signals/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, message: text } : { action }),
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

  const pct = Math.round(draft.signal.confidence * 100);

  return (
    <li className="bg-white rounded-lg border border-[#e5e3df] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="font-semibold">{draft.signal.company.name}</span>
        <Chip size="sm" color="warning">
          {TYPE_LABEL[draft.signal.signalType] ?? draft.signal.signalType}
        </Chip>
        <span className="text-xs text-gray-500">ביטחון {pct}%</span>
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
        אל: {draft.contact.fullName}{draft.contact.currentTitle ? ` · ${draft.contact.currentTitle}` : ""}
      </div>

      <div className="flex flex-col gap-2">
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
        <TextArea
          aria-label="טיוטת הודעה"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full"
          dir="rtl"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            isDisabled={!text.trim() || busy !== null}
            onPress={() => act("approve")}
          >
            <span className="inline-flex items-center gap-1">
              {busy === "approve" && <Loader2 className="w-3 h-3 animate-spin" />}
              אישור ושליחה
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
    </li>
  );
}
