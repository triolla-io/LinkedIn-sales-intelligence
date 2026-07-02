"use client";

import { useReducer } from "react";
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

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <PartyPopper className="w-5 h-5 text-[#c2410c]" />
        <h1 className="text-lg font-semibold">עדכוני תפקיד</h1>
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
            {state.changes.map((c) => (
              <li key={c.id} className="bg-white rounded-lg border border-[#e5e3df] p-4">
                <div className="flex items-center justify-between">
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[#0a66c2] inline-flex items-center gap-1"
                  >
                    {c.fullName} <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className="text-xs text-gray-400">
                    {new Date(c.detectedAt).toLocaleDateString("he-IL")}
                  </span>
                </div>
                <div className="mt-1 text-sm text-gray-700">
                  {c.prevTitle !== c.newTitle && (
                    <div>תפקיד: <span className="line-through text-gray-400">{c.prevTitle ?? "—"}</span> ← <span className="font-medium">{c.newTitle ?? "—"}</span></div>
                  )}
                  {c.prevCompany !== c.newCompany && (
                    <div>חברה: <span className="line-through text-gray-400">{c.prevCompany ?? "—"}</span> ← <span className="font-medium">{c.newCompany ?? "—"}</span></div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
