"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";

/**
 * How the system decided — the calibration screen.
 *
 * Dark on purpose: this is the engine room, and the visual break from the two paper
 * tabs is the fastest way to know which screen you are on. It shows what STOPPED
 * alongside what passed, because a gate that rejects everything looks identical to a
 * working one if you only see survivors.
 */

type JourneyStep = { key: string; state: "pass" | "fail" | "empty"; name: string; value: string };
type Journey = {
  steps: JourneyStep[];
  verdict: { tone: "good" | "bad"; text: string };
  overridable: boolean;
};

type Item = {
  itemId: string;
  title: string;
  url: string | null;
  sourceHost: string | null;
  snippetOnly: boolean;
  person: { contactId: string; fullName: string };
  journey: Journey;
  draftId: string | null;
};

type Decisions = {
  run: { scanned: number; topical: number; important: number; connected: number; drafts: number; finishedAt: string } | null;
  items: Item[];
  people: { contactId: string; fullName: string }[];
  quietAxes: { label: string; person: string; queries: number; results: number; hebrewNoIsraeliSource: boolean }[];
};

const EN_INK = "text-[#e8ecf2]";
const EN_INK_2 = "text-[rgba(232,236,242,0.66)]";
const EN_INK_3 = "text-[rgba(232,236,242,0.42)]";
const PASS = "#5fb878";
const FAIL = "#e07a6a";

type Filter = { person: string | null; rejectedOnly: boolean; thinOnly: boolean };

function Funnel({ run }: { run: NonNullable<Decisions["run"]> }) {
  const segs = [
    { v: run.scanned, l: "נסרקו" },
    { v: run.topical, l: "תוכן ענייני" },
    { v: run.important, l: "חשובות מספיק" },
    { v: run.connected, l: "עם חיבור אישי" },
    { v: run.drafts, l: "טיוטות", final: true },
  ];
  return (
    <div className="flex flex-wrap mb-7">
      {segs.map((s, i) => (
        <div
          key={s.l}
          className={cn(
            // Wraps three-up on a phone, one row from sm — five columns of 20% each are
            // unreadable at 390px.
            "flex-1 min-w-[32%] sm:min-w-0 text-center py-3 px-1.5 bg-[#1e242e]",
            i > 0 && "border-s border-[rgba(232,236,242,0.09)]",
            i === 0 && "rounded-s-xl",
            i === segs.length - 1 && "rounded-e-xl"
          )}
        >
          <div
            // Explicit colour: the page's inherited ink is dark, and on this surface an
            // unstyled number is invisible.
            className={cn("text-[22px] font-bold tabular-nums tracking-tight", EN_INK)}
            style={s.final ? { color: PASS } : undefined}
          >
            {s.v}
          </div>
          <div className={cn("text-[11.5px] mt-0.5", EN_INK_3)}>{s.l}</div>
        </div>
      ))}
    </div>
  );
}

function Stepper({ steps }: { steps: JourneyStep[] }) {
  return (
    <div className="flex flex-wrap mt-4">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1 min-w-[33%] sm:min-w-0 relative text-center pt-1">
          {i > 0 && (
            <span
              className="absolute top-[11px] end-1/2 w-full h-[2px]"
              style={{
                background:
                  steps[i - 1].state === "pass" ? `${PASS}66` : "rgba(232,236,242,0.09)",
              }}
              aria-hidden
            />
          )}
          <span
            className="relative z-10 w-4 h-4 rounded-full mx-auto grid place-items-center text-[9px] border-2"
            style={{
              background:
                s.state === "pass" ? PASS : s.state === "fail" ? FAIL : "#171b22",
              borderColor:
                s.state === "pass" ? PASS : s.state === "fail" ? FAIL : "rgba(232,236,242,0.28)",
              color: "#10151c",
            }}
          >
            {s.state === "pass" ? "✓" : s.state === "fail" ? "✕" : ""}
          </span>
          <div
            className={cn("text-[11px] mt-1.5 font-semibold", s.state === "fail" ? "" : EN_INK_3)}
            style={s.state === "fail" ? { color: FAIL } : undefined}
          >
            {s.name}
          </div>
          <div
            className={cn("text-[11px] mt-px", s.state === "pass" ? "" : EN_INK_2)}
            style={
              s.state === "pass" ? { color: PASS } : s.state === "fail" ? { color: FAIL } : undefined
            }
          >
            {s.value || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

function ItemCard({ item, onOverridden }: { item: Item; onOverridden: () => void }) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const good = item.journey.verdict.tone === "good";

  async function override() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/radar/drafts/${item.draftId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(
          body.error === "draft_failed"
            ? "הניסוח לא עבר את בדיקות האיכות — לא נשמרה טיוטה."
            : "הדריסה נכשלה."
        );
        return;
      }
      setShowReason(false);
      onOverridden();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#1e242e] border border-[rgba(232,236,242,0.09)] rounded-[14px] px-5 py-4 mb-3.5">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className={cn("font-bold text-[14.5px]", EN_INK)}>{item.title}</span>
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className={cn("text-xs hover:underline", EN_INK_3)}
          >
            {item.sourceHost}
            <ExternalLink className="size-3 inline align-baseline ms-0.5" aria-hidden />
          </a>
        ) : (
          <span className={cn("text-xs", EN_INK_3)}>{item.sourceHost}</span>
        )}
        {item.snippetOnly && (
          <span className="text-[11px] rounded-full px-2 py-0.5" style={{ background: "rgba(224,122,106,0.12)", color: FAIL }}>
            לא נקראה עד הסוף
          </span>
        )}
        <span
          className={cn("ms-auto text-xs rounded-full px-2.5 py-0.5 bg-[#232a36]", EN_INK_2)}
        >
          → {item.person.fullName}
        </span>
      </div>

      <Stepper steps={item.journey.steps} />

      <div
        className="mt-3.5 text-[13px] leading-relaxed rounded-[10px] px-3.5 py-2.5 border-s-[3px]"
        style={{
          background: good ? "rgba(95,184,120,0.08)" : "rgba(224,122,106,0.08)",
          borderInlineStartColor: good ? PASS : FAIL,
          color: good ? "#a9d8b6" : "#eda99e",
        }}
      >
        {item.journey.verdict.text}
        {item.journey.overridable && item.draftId && !showReason && (
          <button onClick={() => setShowReason(true)} className="underline ms-2">
            דרוס ידנית ↗
          </button>
        )}
      </div>

      {showReason && (
        <div className="mt-2.5 flex flex-wrap gap-2 items-center">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="למה השער טעה? (לא חובה — אבל זה מה שמלמד אותו)"
            aria-label="סיבת הדריסה"
            className={cn(
              "flex-1 min-w-[240px] bg-[#171b22] border border-[rgba(232,236,242,0.14)] rounded-lg px-3 py-1.5 text-[13px] outline-none",
              EN_INK
            )}
          />
          <button
            disabled={busy}
            onClick={() => void override()}
            className="text-[13px] font-semibold rounded-lg px-3.5 py-1.5 bg-[#232a36] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            נסח ושלח לאישור
          </button>
          <button onClick={() => setShowReason(false)} className={cn("text-[13px]", EN_INK_3)}>
            ביטול
          </button>
        </div>
      )}

      {error && (
        <p className="text-[12.5px] mt-2" style={{ color: FAIL }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function DecisionsTab() {
  const [filter, setFilter] = useState<Filter>({ person: null, rejectedOnly: false, thinOnly: false });
  const { data, error, isLoading, mutate } = useSWR<Decisions>("/api/radar/decisions", fetcher, {
    revalidateOnFocus: true,
  });

  const chip = (on: boolean) =>
    cn(
      "text-[12.5px] rounded-full px-3.5 py-1 border font-medium",
      on
        ? "bg-[#232a36] border-[rgba(232,236,242,0.22)] text-[#e8ecf2]"
        : cn("border-[rgba(232,236,242,0.09)] bg-transparent", EN_INK_2)
    );

  const items = (data?.items ?? []).filter(
    (i) =>
      (filter.person === null || i.person.contactId === filter.person) &&
      (!filter.rejectedOnly || i.journey.verdict.tone === "bad") &&
      (!filter.thinOnly || i.snippetOnly)
  );

  return (
    <section className="bg-[#171b22] -mx-4 sm:-mx-6 px-4 sm:px-6 py-7 pb-14 rounded-[20px]">
      <p className={cn("text-sm mb-4", EN_INK_2)}>
        כך המערכת מחליטה: כל כתבה עוברת ארבע החלטות בדרך לטיוטה. מה שנעצר — הסיבה כתובה
        בדיוק בנקודת העצירה.
      </p>

      {error && !data ? (
        <p className="text-sm flex items-center gap-1.5" style={{ color: FAIL }} role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {fetchErrorMessage(error)}
        </p>
      ) : isLoading || !data ? (
        <div className={cn("flex items-center gap-2", EN_INK_3)}>
          <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
        </div>
      ) : (
        <>
          {data.run ? (
            <Funnel run={data.run} />
          ) : (
            <p className={cn("text-[13.5px] mb-6", EN_INK_3)}>
              עוד לא הסתיימה סריקה, אז אין משפך להראות. אחרי הסריקה הבאה יופיעו כאן המספרים
              של כל שלב.
            </p>
          )}

          <div className="flex gap-2 flex-wrap mb-5">
            <button
              className={chip(filter.person === null && !filter.rejectedOnly && !filter.thinOnly)}
              onClick={() => setFilter({ person: null, rejectedOnly: false, thinOnly: false })}
            >
              כולם
            </button>
            {data.people.map((p) => (
              <button
                key={p.contactId}
                className={chip(filter.person === p.contactId)}
                onClick={() =>
                  setFilter((f) => ({ ...f, person: f.person === p.contactId ? null : p.contactId }))
                }
              >
                {p.fullName.split(" ")[0]}
              </button>
            ))}
            <button
              className={chip(filter.rejectedOnly)}
              onClick={() => setFilter((f) => ({ ...f, rejectedOnly: !f.rejectedOnly }))}
            >
              רק נפסלו
            </button>
            <button
              className={chip(filter.thinOnly)}
              onClick={() => setFilter((f) => ({ ...f, thinOnly: !f.thinOnly }))}
            >
              כתבות שלא נקראו עד הסוף
            </button>
          </div>

          {items.length === 0 ? (
            <p className={cn("text-[13.5px]", EN_INK_3)}>
              {data.items.length === 0
                ? "עוד לא נשפטה אף כתבה. אחרי הסריקה הבאה יופיע כאן המסלול של כל אחת."
                : "אין כתבות שמתאימות לסינון הזה."}
            </p>
          ) : (
            items.map((i) => (
              <ItemCard
                key={`${i.itemId}-${i.person.contactId}`}
                item={i}
                onOverridden={() => void mutate()}
              />
            ))
          )}

          {data.quietAxes.length > 0 && (
            <div className="mt-7 pt-4.5 border-t border-[rgba(232,236,242,0.09)]">
              <h3 className={cn("text-[13px] font-bold mb-2.5", EN_INK_3)}>
                צירים בלי חומר השבוע — לא באג, שקט
              </h3>
              {data.quietAxes.map((a, i) => (
                <div
                  key={`${a.label}-${i}`}
                  className="flex justify-between gap-3 text-[13px] py-1.5 border-b border-dashed border-[rgba(232,236,242,0.09)] flex-wrap"
                >
                  <span className={EN_INK_2}>
                    {a.label}
                    {a.person && ` · ${a.person}`}
                  </span>
                  <span className={cn("text-xs", EN_INK_3)}>
                    <span className="tabular-nums">0</span> תוצאות ב-
                    <span className="tabular-nums">{a.queries}</span> שאילתות
                    {a.hebrewNoIsraeliSource && (
                      <span style={{ color: FAIL }}> · שאילתת עברית לא החזירה מקור ישראלי ⚠</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
