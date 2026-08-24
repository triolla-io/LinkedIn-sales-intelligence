"use client";

import useSWR from "swr";
import { Loader2, ExternalLink, AlertTriangle, Ban, Check } from "lucide-react";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";

/**
 * The review screen for the person-outward radar.
 *
 * Grouped by PERSON. A company-grouped feed would re-establish exactly the frame that
 * produced three byte-identical drafts to three founders of one company.
 *
 * It deliberately shows what was REJECTED next to what was accepted. The judgement this
 * screen exists to support is "is the reason good enough to send", and that cannot be
 * made from survivors alone — a gate that rejects everything looks identical to a gate
 * that is working if you only see what got through.
 */

type Match = {
  itemId: string;
  title: string;
  summary: string;
  url: string | null;
  kind: string;
  shareworthy: number;
  stature: number;
  snippetOnly: boolean;
  score: number;
  rationale: string;
};

type Axis = {
  id: string;
  label: string;
  kind: string;
  subscribers: number;
  weight: number;
  rationale: string;
  matches: Match[];
};

type Draft = {
  id: string;
  status: string;
  message: string | null;
  whyHim: string | null;
  confidence: number;
  discardReason: string | null;
  item: { title: string; kind: string; url: string | null; summary: string | null };
};

/** The domain shown as the fact's provenance. Null for an unparseable URL. */
function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

type Person = {
  contactId: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  linkedinUrl: string | null;
  roleLens: string;
  personalNotes: string | null;
  axes: Axis[];
  drafts: Draft[];
};

type Health = {
  /** When the newest item was written, so a stale page is visibly stale. */
  lastItemAt: string | null;
  people: number;
  axes: number;
  sharedAxes: number;
  matches: number;
  accepted: number;
  vetoed: number;
  vetoRate: number | null;
};

const MUTED = "text-[#6b6866]";
const FAINT = "text-[#9b9895]";

const KIND_HE: Record<string, string> = {
  research: "מחקר",
  trend: "מגמה",
  big_news: "חדשות",
  company_move: "מהלך של חברה",
  vendor_launch: "השקת ספק",
  promotion: "קידום",
  other: "אחר",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={cn("text-xs", FAINT)}>{label}</div>
      <div className={cn("text-lg", tone ?? "text-[#1a1917]")}>{value}</div>
    </div>
  );
}

function AxisRow({ axis }: { axis: Axis }) {
  return (
    <li className="py-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm text-[#1a1917]">{axis.label}</span>
        {/* The number that says whether the catalog pools interests or mints one per
            person. One subscriber everywhere means per-person fit in disguise. */}
        {axis.subscribers > 1 && (
          <span className={cn(ui.chip, "text-[11px]")}>{axis.subscribers} מנויים</span>
        )}
        {axis.kind === "COMPANY_MONITOR" && (
          <span className={cn(ui.chip, "text-[11px]")}>ניטור חברה</span>
        )}
      </div>
      <p className={cn("text-xs mt-0.5", MUTED)}>{axis.rationale}</p>

      {axis.matches.length === 0 ? (
        <p className={cn("text-xs mt-1", FAINT)}>לא נמצאו כתבות לציר הזה בסריקה האחרונה.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2.5">
          {axis.matches.map((m) => (
            <li key={m.itemId} className="flex items-start gap-2">
              <span
                className={cn(
                  "shrink-0 tabular-nums w-9 text-center text-xs pt-0.5",
                  m.score >= 0.5 ? "text-[#1585ff]" : FAINT
                )}
                title="ציון ההתאמה לציר"
              >
                {m.score.toFixed(2)}
              </span>
              <span className="min-w-0">
                {/* The title is a LINK. Judging "would I forward this" is impossible
                    without being able to open the thing. */}
                {m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#1585ff] hover:underline"
                  >
                    {m.title}
                    <ExternalLink className="size-3 inline align-baseline ms-1" aria-hidden />
                  </a>
                ) : (
                  <span className="text-sm text-[#1a1917]">{m.title}</span>
                )}
                <span className={cn("text-xs ms-1", FAINT)}>· {KIND_HE[m.kind] ?? m.kind}</span>
                {/* The Hebrew summary we already paid to write. Without it the reader has
                    to open every link to form any opinion at all. */}
                {/* A summary built from a snippet rather than the page is labelled, not
                    hidden: it is usable context and it is not evidence. */}
                {m.snippetOnly && (
                  <span className="block text-xs mt-0.5 text-[#b42318]">
                    ⚠ הסיכום נוצר מקטע חיפוש ולא מהכתבה — לא אמין, פתחי את הקישור
                  </span>
                )}
                {m.summary && (
                  <span className={cn("block text-xs mt-0.5 leading-relaxed", MUTED)}>{m.summary}</span>
                )}
                {m.rationale && (
                  <span className={cn("block text-xs mt-0.5", FAINT)}>למה זה תואם לציר: {m.rationale}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const vetoed = draft.status === "VETOED";
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        vetoed ? "border-[#f0eee9] bg-[#faf9f7]" : "border-[#cfe4ff] bg-[#f5faff]"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs mb-1.5">
        {vetoed ? (
          <>
            <Ban className="size-3.5 text-[#b42318] shrink-0" aria-hidden />
            <span className="text-[#b42318]">נדחה בווטו</span>
          </>
        ) : (
          <>
            <Check className="size-3.5 text-[#1585ff] shrink-0" aria-hidden />
            <span className="text-[#1585ff]">טיוטה · ביטחון {draft.confidence.toFixed(2)}</span>
          </>
        )}
        <span className={cn("truncate", FAINT)}>· {draft.item.title}</span>
        {/* The domain is VISIBLE, not an icon: the reviewer must see where the facts
            come from — and a search-engine domain here is itself a finding. */}
        {draft.item.url && (
          <a
            href={draft.item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#1585ff] shrink-0 inline-flex items-center gap-0.5"
            aria-label="הכתבה המקורית"
          >
            {sourceHost(draft.item.url)}
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      {/* The veto's sentence, shown for BOTH outcomes. On an accepted draft it is the
          reason the message exists; on a rejection it is the only thing that says
          whether the gate is being sensible. */}
      {draft.whyHim && (
        <p className={cn("text-xs mb-1.5", vetoed ? "text-[#b42318]" : MUTED)}>{draft.whyHim}</p>
      )}

      {draft.message && (
        <p className="text-sm text-[#1a1917] whitespace-pre-wrap leading-relaxed">{draft.message}</p>
      )}

      {/* The item's own words — the only text a figure in the message may come from.
          Shown so every claim can be checked against its source without leaving the card. */}
      {draft.item.summary && (
        <p className={cn("text-xs mt-1.5 pt-1.5 border-t", vetoed ? "border-[#f0eee9]" : "border-[#cfe4ff]", MUTED)}>
          מה המקור אומר: {draft.item.summary}
        </p>
      )}
    </div>
  );
}

export function RadarReview() {
  // Polls. This screen shows the result of a background scan, so a page opened while a
  // run is in flight would otherwise sit empty forever — and "empty" and "stale" look
  // identical, which is the same silent-failure shape as a failed fetch rendering as
  // "no results". 20s is cheap: the payload is one owner's people, not a contact scan.
  const { data, error, isLoading } = useSWR<{ people: Person[]; health: Health }>(
    "/api/radar/review",
    fetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true }
  );

  const people = data?.people ?? [];
  const health = data?.health;

  return (
    <div className="flex-1 p-5 flex flex-col gap-5" dir="rtl">
      <div>
        <h1 className={ui.sectionTitle}>ראדאר קשרים — סקירה</h1>
        <p className={cn("text-xs mt-1", MUTED)}>
          מסודר לפי אדם. מה שנדחה מוצג ליד מה שעבר, כי אחרת אין דרך להבדיל בין שער שעובד
          לשער שמחמיר מדי.
        </p>
      </div>

      {/* A failed load must not read as "nothing was found". */}
      {error && !data ? (
        <p className="text-sm text-[#b42318] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {fetchErrorMessage(error)}
        </p>
      ) : isLoading ? (
        <div className={cn("flex items-center gap-2", FAINT)}>
          <Loader2 className="size-4 animate-spin" /> טוען…
        </div>
      ) : (
        <>
          {health && (
            <div className={cn(ui.card, "p-4 grid grid-cols-3 sm:grid-cols-7 gap-4")}>
              <Stat label="אנשים" value={String(health.people)} />
              <Stat label="צירים" value={String(health.axes)} />
              <Stat label="צירים משותפים" value={String(health.sharedAxes)} />
              <Stat label="התאמות" value={String(health.matches)} />
              <Stat label="טיוטות" value={String(health.accepted)} />
              {/* The pilot's central metric: near zero means the gate is lenient, near
                  one means the axes are too broad. Either way it has to be visible. */}
              <Stat
                label="סריקה אחרונה"
                value={
                  health.lastItemAt
                    ? new Date(health.lastItemAt).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : "—"
                }
              />
              <Stat
                label="אחוז ווטו"
                value={health.vetoRate == null ? "—" : `${Math.round(health.vetoRate * 100)}%`}
                tone={
                  health.vetoRate == null
                    ? undefined
                    : health.vetoRate > 0.8 || health.vetoRate < 0.1
                      ? "text-[#b42318]"
                      : "text-[#1a1917]"
                }
              />
            </div>
          )}

          {people.length === 0 ? (
            <p className={cn("text-sm", FAINT)}>
              עוד לא נבנה מודל אדם. סמני אנשים במסך Tech Radar והריצה תבנה את הצירים שלהם.
            </p>
          ) : (
            people.map((p) => (
              <div key={p.contactId} className={cn(ui.card, "p-4")}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="text-sm text-[#1a1917]">{p.fullName}</h2>
                  {p.linkedinUrl && (
                    <a
                      href={p.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1585ff]"
                      aria-label={`פרופיל לינקדאין של ${p.fullName}`}
                    >
                      <ExternalLink className="size-3.5 inline align-middle" />
                    </a>
                  )}
                  <span className={cn("text-xs", FAINT)}>
                    {p.currentTitle ?? "?"} @ {p.currentCompany ?? "?"}
                  </span>
                </div>
                <p className={cn("text-xs mt-1", MUTED)}>{p.roleLens}</p>
                {p.personalNotes && (
                  <p className={cn("text-xs mt-0.5", FAINT)}>הערות: {p.personalNotes}</p>
                )}

                {p.drafts.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {p.drafts.map((d) => (
                      <DraftCard key={d.id} draft={d} />
                    ))}
                  </div>
                )}

                <p className={cn(ui.label, "mt-3 mb-0")}>הצירים שלו</p>
                <ul className="divide-y divide-[#f0eee9]">
                  {p.axes.map((a) => (
                    <AxisRow key={a.id} axis={a} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
