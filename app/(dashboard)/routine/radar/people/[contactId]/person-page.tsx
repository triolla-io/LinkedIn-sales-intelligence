"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@heroui/react";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";

/**
 * One person: what the system thinks interests them, and the ability to say "no, not
 * that". A muted axis stays on screen, greyed, with a way back — a correction the user
 * cannot see is a correction they cannot undo.
 */

type PrepStage = { key: string; state: "done" | "running" | "waiting" | "failed"; detail: string };

type Person = {
  contactId: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  linkedinUrl: string | null;
  messageLanguage: "he" | "en";
  active: boolean;
  lastMessageFromUsAt: string | null;
  prep: { ready: boolean; failed: boolean; stages: PrepStage[] };
  axes: { id: string; label: string; source: "role" | "company"; muted: boolean; itemsFound: number }[];
  history: { id: string; status: string; statusText: string; itemTitle: string; at: string }[];
};

const INK_2 = "text-[rgba(28,36,48,0.72)]";
const INK_3 = "text-[rgba(28,36,48,0.5)]";

const SOURCE_HE: Record<Person["axes"][number]["source"], string> = {
  role: "נגזר מהתפקיד ומהחברה",
  company: "ממה שהחברה מתמודדת איתו עכשיו",
};

function relativeHe(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${days} ימים`;
  if (days < 14) return "לפני שבוע";
  if (days < 30) return `לפני ${Math.floor(days / 7)} שבועות`;
  return `לפני ${Math.floor(days / 30)} חודשים`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn("text-xs rounded-full px-[11px] py-[3.5px] border bg-white border-[rgba(28,36,48,0.1)]", INK_2)}>
      {children}
    </span>
  );
}

export function PersonPage({ contactId }: { contactId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR<Person>(
    `/api/radar/people/${contactId}`,
    fetcher,
    { revalidateOnFocus: true }
  );

  async function patch(body: Record<string, unknown>, key: string) {
    setBusy(key);
    try {
      await fetch(`/api/radar/people/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div dir="rtl" className="flex-1 bg-[#faf8f4] p-6">
        <p className="text-sm text-[#b42318] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {fetchErrorMessage(error)}
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div dir="rtl" className={cn("flex-1 bg-[#faf8f4] p-6 flex items-center gap-2", INK_3)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
      </div>
    );
  }

  const live = data.axes.filter((a) => !a.muted);

  return (
    <div dir="rtl" className="flex-1 min-h-full bg-[#faf8f4] text-[#1c2430]">
      <div className="max-w-[880px] mx-auto px-4 sm:px-6 pt-6 pb-20">
        <Link
          href="/routine/radar?tab=people"
          className={cn("inline-flex items-center gap-1 text-[13px] mb-5", INK_3)}
        >
          <ArrowRight className="size-3.5" aria-hidden />
          חזרה לאנשים
        </Link>

        {/* who */}
        <div className="bg-white border border-[rgba(28,36,48,0.06)] rounded-[20px] p-5 sm:p-7">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold tracking-tight">{data.fullName}</h1>
              <p className={cn("text-[13.5px] mt-0.5", INK_3)}>
                {[data.currentTitle, data.currentCompany].filter(Boolean).join(" · ")}
              </p>
            </div>
            {data.linkedinUrl && (
              <a
                href={data.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ms-auto text-[12.5px] text-[#0a66c2] border border-[rgba(10,102,194,0.25)] rounded-full px-3 py-1"
              >
                לינקדאין ↗
              </a>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-4 items-center">
            <Chip>
              {data.active ? "בראדאר · פעיל" : "בראדאר · כבוי"}
            </Chip>
            <Chip>
              הודעה אחרונה מכאן: {relativeHe(data.lastMessageFromUsAt) ?? "אף פעם"}
            </Chip>
            <span className={cn("text-xs ms-2", INK_3)}>שפת הודעות:</span>
            <div className="flex bg-[rgba(28,36,48,0.05)] rounded-full p-[3px]">
              {(["he", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  disabled={busy !== null}
                  onClick={() => void patch({ action: "language", value: lang }, `lang-${lang}`)}
                  className={cn(
                    "text-[12px] font-semibold px-3 py-1 rounded-full transition-all disabled:opacity-60",
                    data.messageLanguage === lang ? "bg-white shadow-[0_1px_3px_rgba(28,36,48,0.12)]" : INK_3
                  )}
                >
                  {lang === "he" ? "עברית" : "אנגלית"}
                </button>
              ))}
            </div>
            <button
              disabled={busy !== null}
              onClick={() => void patch({ action: "active", value: !data.active }, "active")}
              className={cn("text-[12.5px] ms-auto underline disabled:opacity-60", INK_3)}
            >
              {data.active ? "כיבוי בראדאר" : "הפעלה בראדאר"}
            </button>
          </div>
        </div>

        {/* what the system thinks interests him */}
        <div className="bg-white border border-[rgba(28,36,48,0.06)] rounded-[20px] p-5 sm:p-7 mt-5">
          <h2 className="text-[15px] font-bold">מה לדעת המערכת מעניין אותו — ואפשר לתקן אותה</h2>

          {data.axes.length === 0 ? (
            <div className="mt-3">
              {data.prep.failed ? (
                <>
                  <p className="text-[13.5px] text-[#b42318]">
                    {data.prep.stages.find((s) => s.state === "failed")?.detail ?? "ההכנה נעצרה"}
                  </p>
                  <p className={cn("text-[12.5px] mt-1", INK_3)}>
                    אפשר לנסות שוב מטאב ״אנשים״.
                  </p>
                </>
              ) : (
                <p className={cn("text-[13.5px]", INK_3)}>
                  התחומים עדיין נבנים — הם יופיעו כאן ברגע שהמערכת תסיים לקרוא על החברה.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-2">
              {data.axes.map((a, i) => (
                <div
                  key={a.id}
                  className={cn(
                    "flex justify-between gap-3 py-2.5 flex-wrap",
                    i < data.axes.length - 1 && "border-b border-dashed border-[rgba(28,36,48,0.06)]"
                  )}
                >
                  <span className={cn("text-[13.5px] min-w-0", a.muted && "opacity-45")}>
                    <b className="font-semibold">{a.label}</b>
                    <span className={INK_3}> · {SOURCE_HE[a.source]}</span>
                  </span>
                  <span className={cn("text-[12.5px] shrink-0 flex items-center gap-2", INK_3)}>
                    {a.muted ? (
                      "לא מעניין אותו"
                    ) : a.itemsFound > 0 ? (
                      <span className="tabular-nums">{a.itemsFound} ידיעות נמצאו</span>
                    ) : (
                      "שקט השבוע"
                    )}
                    <button
                      disabled={busy !== null}
                      onClick={() =>
                        void patch(
                          { action: "muteAxis", personAxisId: a.id, muted: !a.muted },
                          `axis-${a.id}`
                        )
                      }
                      className="underline disabled:opacity-60"
                    >
                      {a.muted ? "החזרה" : "לא מעניין אותו ✕"}
                    </button>
                  </span>
                </div>
              ))}
              {live.length === 0 && (
                <p className={cn("text-[12.5px] mt-2", INK_3)}>
                  כל התחומים מושתקים — לא ייסרק עבורו כלום עד שתחזירי אחד מהם.
                </p>
              )}
            </div>
          )}
        </div>

        {/* history */}
        <div className="bg-white border border-[rgba(28,36,48,0.06)] rounded-[20px] p-5 sm:p-7 mt-5">
          <h2 className="text-[15px] font-bold">ההיסטוריה איתו</h2>
          {data.history.length === 0 ? (
            <p className={cn("text-[13.5px] mt-2", INK_3)}>
              עוד לא נשלחה אליו אף הודעה מהראדאר, ואף מועמדות לא נפסלה.
            </p>
          ) : (
            <div className="mt-2">
              {data.history.map((h, i) => (
                <div
                  key={h.id}
                  className={cn(
                    "flex justify-between gap-3 py-2.5 flex-wrap",
                    i < data.history.length - 1 && "border-b border-dashed border-[rgba(28,36,48,0.06)]"
                  )}
                >
                  <span className={cn("text-[13.5px] min-w-0", INK_2)}>
                    <b className="font-semibold text-[#1c2430]">{h.statusText}</b> · {h.itemTitle}
                  </span>
                  <span className={cn("text-[12.5px] shrink-0", INK_3)}>{relativeHe(h.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
