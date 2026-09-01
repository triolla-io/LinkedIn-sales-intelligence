"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";

/**
 * One person: what the system thinks interests them, and the ability to say "no, not
 * that". A muted axis stays on screen, greyed, with a way back — a correction the user
 * cannot see is a correction they cannot undo.
 *
 * Muting is the subtraction; the manual tag below the list is the addition. Both are
 * corrections to a model an LLM built, and a manual one is marked "ידני" because a user
 * who cannot tell their own line apart from the machine's guess cannot audit either.
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
  employerFinding: { noClearCompetitors: boolean; reason: string } | null;
  /**
   * The review surface. Null on every profile built before the person model existed —
   * so the card that shows it is absent, not empty: an "קהל הלקוחות: —" would look like a
   * model that answered nothing, when in truth it was never asked.
   */
  audience: { type: string[]; who: string; geography: string } | null;
  scope: { owns: string[]; notOwns: string[] } | null;
  career: {
    tenureYearsInCurrentRole: number | null;
    path: { title: string; company: string | null; years: number | null }[];
  } | null;
  axes: {
    id: string;
    label: string;
    source: "role" | "company" | "entity" | "manual";
    muted: boolean;
    itemsFound: number;
    /** Which of the four staged questions produced it. Null on axes built before the
     *  stage tag was persisted — the build always knew, it just threw it away. */
    stage: string | null;
  }[];
  history: { id: string; status: string; statusText: string; itemTitle: string; at: string }[];
  stageMix?: {
    present: string[];
    missing: string[];
    unknown: number;
    thin: boolean;
    own: number;
  };
};

const INK_2 = "text-[var(--muted)]";
const INK_3 = "text-[var(--faint)]";

/** The four appetites, in the words a human reads them in. */
const STAGE_HE: Record<string, string> = {
  decision: "החלטה שהוא מחזיק",
  competitor: "מי מתחרה עליו",
  stop_and_read: "מה יעצור אותו",
  adopt: "מה אפשר לאמץ",
};

const SOURCE_HE: Record<Person["axes"][number]["source"], string> = {
  role: "נגזר מהתפקיד ומהחברה",
  company: "ממה שהחברה מתמודדת איתו עכשיו",
  entity: "שם שהמערכת זיהתה שהוא עוקב אחריו",
  manual: "הוספת בעצמך",
};

/** Why the add failed, in words the user can act on. */
const TAG_ERROR_HE: Record<string, string> = {
  already_exists: "התגית הזאת כבר רשומה אצלו.",
  name_required: "צריך לכתוב שם לתגית.",
  name_not_distinctive: "השם הזה לא מספק — צריך שם ממשי, לא מילות קישור.",
  no_person_profile: "המודל שלו עוד נבנה — אפשר להוסיף תגיות ברגע שהתחומים יופיעו כאן.",
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

/**
 * "B2C · משקי בית ולקוחות פרטיים · ישראל". Every part is optional in the data —
 * `geography` is legitimately "" for an internal audience — so the line is assembled from
 * whatever is actually there rather than from a fixed template with holes in it.
 */
function audienceHe(a: NonNullable<Person["audience"]>): string {
  const types = Array.isArray(a.type) ? a.type : [];
  return [...types, a.who, a.geography]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" · ");
}

/**
 * Tenure in words. `null` (no parsable start year) yields null and the chip disappears —
 * a "0 שנים" would read as a fact about the person instead of a gap in the scrape.
 */
function tenureHe(years: number | null | undefined): string | null {
  if (years == null) return null;
  if (years === 0) return "פחות משנה";
  if (years === 1) return "שנה";
  return `${years} שנים`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn("text-xs rounded-full px-[11px] py-[3.5px] border bg-surface border-[var(--line)]", INK_2)}>
      {children}
    </span>
  );
}

export function PersonPage({ contactId }: { contactId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
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

  /**
   * The addition half of the correction. Re-fetches rather than patching the cache by
   * hand: the row the server writes carries its own id and provenance chip, and a guessed
   * one would be a second source of truth for the same line.
   */
  async function addTag() {
    const name = tagName.trim();
    if (!name || busy !== null) return;
    setBusy("add-tag");
    setTagError(null);
    try {
      const res = await fetch(`/api/radar/people/${contactId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setTagError(TAG_ERROR_HE[body.error ?? ""] ?? "לא הצלחנו להוסיף את התגית.");
        return;
      }
      setTagName("");
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) {
    return (
      <div dir="rtl" className="flex-1 bg-[var(--surface-secondary)] p-6">
        <p className="text-sm text-[var(--danger)] flex items-center gap-1.5" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {fetchErrorMessage(error)}
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div dir="rtl" className={cn("flex-1 bg-[var(--surface-secondary)] p-6 flex items-center gap-2", INK_3)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
      </div>
    );
  }

  const live = data.axes.filter((a) => !a.muted);
  const owns = data.scope?.owns ?? [];
  const notOwns = data.scope?.notOwns ?? [];
  const tenure = tenureHe(data.career?.tenureYearsInCurrentRole);
  // Empty is treated as absent: a "קהל הלקוחות: " with nothing after it is a dangling label,
  // and for the purpose of reviewing a model an audience with no content in it says
  // exactly as much as no audience at all.
  const audienceText = data.audience ? audienceHe(data.audience) : "";

  return (
    <div dir="rtl" className="flex-1 min-h-full bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-[880px] mx-auto px-4 sm:px-6 pt-6 pb-20">
        <Link
          href="/routine/radar?tab=people"
          className={cn("inline-flex items-center gap-1 text-[13px] mb-5", INK_3)}
        >
          <ArrowRight className="size-3.5" aria-hidden />
          חזרה לאנשים
        </Link>

        {/* who */}
        <div className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7">
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
                className="ms-auto text-[12.5px] text-[var(--brand-linkedin)] border border-[var(--brand-linkedin)]/25 rounded-full px-3 py-1"
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
            <div className="flex bg-[var(--surface-secondary)] rounded-full p-[3px]">
              {(["he", "en"] as const).map((lang) => (
                <button
                  key={lang}
                  disabled={busy !== null}
                  onClick={() => void patch({ action: "language", value: lang }, `lang-${lang}`)}
                  className={cn(
                    "text-[12px] font-semibold px-3 py-1 rounded-full transition-all disabled:opacity-60",
                    data.messageLanguage === lang ? "bg-surface shadow-[0_1px_3px_rgba(28,36,48,0.12)]" : INK_3
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

        {/* Whose customers she serves, and what is on her desk — read-only, and the thing
            a human reads BEFORE approving a rebuilt model. It sits above the axes because
            every axis below is supposed to follow from it: an axis about a line she does
            not hold is visibly wrong once this line is on screen.

            Absent, not empty, when the profile predates the person model: a card of
            em-dashes would claim the model answered and answered nothing. */}
        {audienceText && (
          <section className="bg-surface border border-[var(--separator)] rounded-[20px] px-5 sm:px-7 py-4 mt-5">
            <div className="flex items-start gap-3 flex-wrap">
              <p className="text-[13.5px] min-w-0">
                <span className={INK_3}>קהל הלקוחות: </span>
                <b className="font-semibold">{audienceText}</b>
              </p>
              {tenure && (
                <span className="ms-auto shrink-0">
                  <Chip>בתפקיד: {tenure}</Chip>
                </span>
              )}
            </div>

            {(owns.length > 0 || notOwns.length > 0) && (
              <div className="mt-2.5 pt-2.5 border-t border-dashed border-[var(--separator)] flex flex-col gap-1">
                {owns.length > 0 && (
                  <p className={cn("text-[13px]", INK_2)}>
                    <span className={INK_3}>על השולחן: </span>
                    {owns.join(" · ")}
                  </p>
                )}
                {/* The half that no other field records — and the half that does the
                    filtering: a story about a line she does not hold dies here. */}
                {notOwns.length > 0 && (
                  <p className={cn("text-[13px]", INK_2)}>
                    <span className={INK_3}>לא על השולחן: </span>
                    {notOwns.join(" · ")}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* what the system thinks interests him */}
        <div className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7 mt-5">
          <h2 className="text-[15px] font-bold">מה לדעת המערכת מעניין אותו — ואפשר לתקן אותה</h2>
          {/* The mix, said out loud. A person with two axes, both derivable from their job
              title, used to render exactly like a person covering all four appetites — the
              only difference was invisible, and invisible is how it stayed for a week. */}
          {data.stageMix && (data.stageMix.thin || data.stageMix.missing.length > 0) && (
            <p className={cn("text-[12.5px] mt-1.5", INK_2)}>
              {data.stageMix.thin && (
                <span>
                  המודל דק: {data.stageMix.own} תחומים משלו (הרצפה היא 3).{" "}
                </span>
              )}
              {data.stageMix.missing.length > 0 && (
                <span>
                  חסר לו:{" "}
                  {data.stageMix.missing.map((x) => STAGE_HE[x] ?? x).join(" · ")}.{" "}
                </span>
              )}
              {data.stageMix.unknown > 0 && (
                <span>({data.stageMix.unknown} תחומים נבנו לפני שהסוג נשמר.)</span>
              )}
            </p>
          )}

          {/* The research's active "no competitors" finding — shown with its reason so a
              human can spot when the model got it wrong and fix the company by hand. */}
          {data.employerFinding?.noClearCompetitors && (
            <p className={cn("text-[12.5px] mt-1.5", INK_3)}>
              לא זוהו מתחרים ישירים{data.employerFinding.reason ? ` — ${data.employerFinding.reason}` : ""}
            </p>
          )}

          {data.axes.length === 0 ? (
            <div className="mt-3">
              {data.prep.failed ? (
                <>
                  <p className="text-[13.5px] text-[var(--danger)]">
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
                    i < data.axes.length - 1 && "border-b border-dashed border-[var(--separator)]"
                  )}
                >
                  <span className={cn("text-[13.5px] min-w-0 flex items-center gap-1.5 flex-wrap", a.muted && "opacity-45")}>
                    <b className="font-semibold">{a.label}</b>
                    {/* The user's own line, marked as theirs: a rebuild leaves it alone,
                        and that promise is only worth something if it is visible. */}
                    {a.source === "manual" && <Chip>ידני</Chip>}
                    {/* WHICH appetite this axis serves. Until 2026-09-01 the screen showed
                        only the axis's SOURCE, so a person holding nothing but
                        competitor axes looked identical to one covering all four. */}
                    {a.stage && <Chip>{STAGE_HE[a.stage] ?? a.stage}</Chip>}
                    <span className={INK_3}>· {SOURCE_HE[a.source]}</span>
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

          {/* The addition. Muting takes a subject away; this puts one in — and unlike
              everything above it, a rebuild leaves it standing. */}
          <div className="mt-4 pt-4 border-t border-[var(--separator)]">
            <label htmlFor="manual-tag" className={cn("text-[12.5px]", INK_3)}>
              + תגית ידנית
            </label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="manual-tag"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTag();
                }}
                placeholder="למשל: רגולציית סייבר"
                aria-label="תגית ידנית"
                disabled={busy !== null}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="primary"
                isDisabled={busy !== null || tagName.trim() === ""}
                onPress={() => void addTag()}
              >
                הוספה
              </Button>
            </div>
            <p className={cn("text-[12px] mt-1.5", INK_3)}>
              תגית ידנית נשארת גם כשהמערכת בונה את המודל שלו מחדש.
            </p>
            {tagError && (
              <p className="text-[12.5px] mt-1.5 text-[var(--danger)]" role="alert">
                {tagError}
              </p>
            )}
          </div>
        </div>

        {/* history */}
        <div className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7 mt-5">
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
                    i < data.history.length - 1 && "border-b border-dashed border-[var(--separator)]"
                  )}
                >
                  <span className={cn("text-[13.5px] min-w-0", INK_2)}>
                    <b className="font-semibold text-[var(--foreground)]">{h.statusText}</b> · {h.itemTitle}
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
