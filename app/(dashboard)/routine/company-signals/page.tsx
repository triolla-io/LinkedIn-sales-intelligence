"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
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

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const TYPE_LABEL: Record<string, string> = {
  FUNDING: "גיוס", HIRING_GROWTH: "צמיחת כוח אדם", OFFICE_MOVE: "מעבר משרד",
  PRODUCT_LAUNCH: "השקת מוצר", AWARD: "פרס", MILESTONE: "אבן דרך", EXEC_HIRE: "מינוי בכיר",
};

export default function CompanySignalsPage() {
  const { data, isLoading } = useSWR<{ drafts: Draft[] }>("/api/company-signals", fetcher, {
    refreshInterval: 30_000,
  });
  const modules = useSWR<{ companySignalsEnabled: boolean }>("/api/routine/modules", fetcher);

  async function toggleModule(enabled: boolean) {
    await fetch("/api/routine/modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: "companySignals", enabled }),
    });
    mutate("/api/routine/modules");
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#c2410c]" />
          <h1 className="text-lg font-semibold">איתותי חברות — סקירה</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>מודול פעיל</span>
          <input
            type="checkbox"
            checked={modules.data?.companySignalsEnabled ?? false}
            onChange={(e) => toggleModule(e.target.checked)}
          />
        </label>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-gray-500 p-5">
          <Loader2 className="w-4 h-4 animate-spin" /> טוען…
        </div>
      ) : data.drafts.length === 0 ? (
        <div className="p-5 text-gray-500">אין טיוטות ממתינות לסקירה.</div>
      ) : (
        <div className="flex-1 p-5 flex flex-col gap-4">
          {data.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const [text, setText] = useState(draft.draftMessage);
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "dismiss") {
    setBusy(true);
    await fetch(`/api/company-signals/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "approve" ? { action, message: text } : { action }),
    });
    setBusy(false);
    mutate("/api/company-signals");
  }

  const pct = Math.round(draft.signal.confidence * 100);

  return (
    <div className="bg-white rounded-lg border border-[#e5e3df] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="font-semibold">{draft.signal.company.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#fde7d3] text-[#c2410c]">
          {TYPE_LABEL[draft.signal.signalType] ?? draft.signal.signalType}
        </span>
        <span className="text-xs text-gray-500">ביטחון {pct}%</span>
        <span className="text-sm text-gray-700">· {draft.signal.title}</span>
      </div>

      <div className="text-sm text-gray-600">{draft.signal.summary}</div>

      <div className="flex flex-wrap gap-2 text-xs">
        {draft.signal.sources.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[#c2410c] hover:underline">
            <ExternalLink className="w-3 h-3" /> {s.name || new URL(s.url).hostname}
          </a>
        ))}
      </div>

      <div className="text-sm text-gray-700">
        אל: {draft.contact.fullName}{draft.contact.currentTitle ? ` · ${draft.contact.currentTitle}` : ""}
      </div>

      <textarea
        className="w-full min-h-24 rounded-md border border-[#e5e3df] p-2 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="rtl"
      />

      <div className="flex gap-2">
        <button
          disabled={busy || !text.trim()}
          onClick={() => act("approve")}
          className="px-3 py-1.5 rounded-md bg-[#c2410c] text-white text-sm disabled:opacity-50"
        >
          אישור ושליחה
        </button>
        <button
          disabled={busy}
          onClick={() => act("dismiss")}
          className="px-3 py-1.5 rounded-md border border-[#e5e3df] text-sm disabled:opacity-50"
        >
          דחה
        </button>
      </div>
    </div>
  );
}
