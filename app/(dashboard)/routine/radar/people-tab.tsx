"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Button } from "@heroui/react";
import { Loader2, AlertTriangle, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";
import { useDebounced } from "@/lib/hooks/use-debounced";

/**
 * The people on the radar. Adding one is a single click; what happens next is shown as
 * four stages, and a stage that cannot progress says so with a retry — the design's
 * rule that a failure must never look like patience.
 */

type PrepStage = { key: string; state: "done" | "running" | "waiting" | "failed"; detail: string };
type Prep = { ready: boolean; failed: boolean; stages: PrepStage[] };

type Person = {
  contactId: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  active: boolean;
  axisCount: number;
  pendingDrafts: number;
  prep: Prep;
};

type Candidate = { id: string; fullName: string; currentTitle: string | null; currentCompany: string | null };

type CandidateResult = {
  candidates: Candidate[];
  total: number;
  /** True when more matched than were returned — said out loud in the picker. */
  truncated: boolean;
  /** True before anything is typed: the address book is too big to browse. */
  needsQuery: boolean;
};

type PeopleResponse = { people: Person[] };

const INK_2 = "text-[var(--muted)]";
const INK_3 = "text-[var(--faint)]";

const AVATAR_BG = ["#5b7a9d", "#8a6d54", "#7d8b9a", "#6d8a70"];

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

const MARK: Record<PrepStage["state"], string> = {
  done: "✓",
  running: "◌",
  waiting: "·",
  failed: "✕",
};

function Avatar({ name, index }: { name: string; index: number }) {
  return (
    <div
      className="w-[46px] h-[46px] rounded-full grid place-items-center text-white font-bold shrink-0"
      style={{ backgroundColor: AVATAR_BG[index % AVATAR_BG.length] }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

/** A person the pipeline is still working on — or has given up on. */
function PreparingCard({ person, index, onRetry, busy }: {
  person: Person;
  index: number;
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <article
      className={cn(
        "bg-surface rounded-[20px] p-5 sm:p-6 mt-5 border border-dashed",
        person.prep.failed ? "border-[var(--danger-soft)]" : "border-[var(--line)]"
      )}
    >
      <div className="flex items-center gap-3.5">
        <Avatar name={person.fullName} index={index} />
        <div className="min-w-0">
          <div className="font-bold text-[16px] flex items-center gap-2 flex-wrap">
            {person.fullName}
            <span
              className={cn(
                "text-[11px] font-semibold rounded-full px-2 py-0.5",
                person.prep.failed
                  ? "text-[var(--danger)] bg-[var(--danger-soft)]"
                  : "text-[var(--warning)] bg-[var(--warning-soft)]"
              )}
            >
              {person.prep.failed ? "ההכנה נעצרה" : "נוסף הרגע — בהכנה"}
            </span>
          </div>
          <div className={cn("text-[13px]", INK_3)}>
            {[person.currentTitle, person.currentCompany].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-dashed border-[var(--line)]">
        {person.prep.stages.map((s, i) => (
          <div
            key={s.key}
            className={cn(
              "flex justify-between gap-3 py-[7px] text-[13.5px]",
              i < person.prep.stages.length - 1 && "border-b border-dashed border-[var(--separator)]"
            )}
          >
            <span className={s.state === "failed" ? "text-[var(--danger)]" : INK_2}>
              <span className="inline-block w-4">{MARK[s.state]}</span> {s.detail}
            </span>
            {s.state === "running" && (
              <Loader2 className={cn("size-3.5 animate-spin shrink-0 mt-1", INK_3)} aria-hidden />
            )}
          </div>
        ))}
      </div>

      {person.prep.failed && (
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" variant="secondary" isDisabled={busy} onPress={onRetry}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            נסי שוב
          </Button>
          <span className={cn("text-[12.5px]", INK_3)}>ההכנה תתחיל מחדש מהשלב שנעצר.</span>
        </div>
      )}
    </article>
  );
}

function ReadyCard({ person, index }: { person: Person; index: number }) {
  return (
    <Link
      href={`/routine/radar/people/${person.contactId}`}
      className="block bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-6 mt-5 shadow-[0_1px_2px_rgba(28,36,48,0.04),0_8px_28px_-18px_rgba(28,36,48,0.14)] hover:border-[var(--line)] transition-colors"
    >
      <div className="flex items-center gap-3.5">
        <Avatar name={person.fullName} index={index} />
        <div className="min-w-0">
          <div className="font-bold text-[16px] flex items-center gap-2 flex-wrap">
            {person.fullName}
            {!person.active && (
              <span className={cn("text-[11px] rounded-full px-2 py-0.5 bg-[var(--surface-secondary)]", INK_3)}>
                כבוי בראדאר
              </span>
            )}
          </div>
          <div className={cn("text-[13px]", INK_3)}>
            {[person.currentTitle, person.currentCompany].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className={cn("ms-auto text-[12.5px] text-left shrink-0", INK_3)}>
          <span className="tabular-nums">{person.axisCount}</span> תחומי עניין
          {person.pendingDrafts > 0 && (
            <span className="block text-[var(--brand-linkedin)]">
              <span className="tabular-nums">{person.pendingDrafts}</span> ממתינות לאישור
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

function AddPicker({ onPick, onClose, busyId }: {
  onPick: (id: string) => void;
  onClose: () => void;
  busyId: string | null;
}) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 250);

  // Searched in the database: with tens of thousands of contacts, filtering a page of
  // them in the browser means most people simply cannot be found.
  const { data, isLoading } = useSWR<CandidateResult>(
    `/api/radar/people/candidates?q=${encodeURIComponent(debounced)}`,
    fetcher,
    { keepPreviousData: true }
  );
  const shown = data?.candidates ?? [];

  return (
    <div className="bg-surface border border-[var(--line)] rounded-[16px] p-4 mt-4">
      <div className="flex items-center gap-2">
        <Search className={cn("size-4 shrink-0", INK_3)} aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי שם, תפקיד או חברה"
          aria-label="חיפוש איש קשר"
          className="flex-1 bg-transparent border-0 outline-none text-[14px] py-1"
        />
        <button onClick={onClose} aria-label="סגירה" className={INK_3}>
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 max-h-[320px] overflow-y-auto">
        {shown.length === 0 ? (
          <p className={cn("text-[13px] py-3", INK_3)}>
            {data?.needsQuery
              ? "הקלידי שם, תפקיד או חברה כדי לחפש באנשי הקשר שלך."
              : isLoading
                ? "מחפש…"
                : "אין איש קשר שמתאים לחיפוש הזה."}
          </p>
        ) : (
          shown.map((c) => (
            <button
              key={c.id}
              disabled={busyId !== null}
              onClick={() => onPick(c.id)}
              className="w-full text-right flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-[var(--surface-secondary)] disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold truncate">{c.fullName}</span>
                <span className={cn("block text-[12.5px] truncate", INK_3)}>
                  {[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              {busyId === c.id && <Loader2 className="size-4 animate-spin ms-auto shrink-0" aria-hidden />}
            </button>
          ))
        )}
      </div>

      {/* A cut list is said out loud: a missing name must read as "narrow the search",
          never as "this person is not in the system". */}
      {data?.truncated && (
        <p className={cn("text-[12px] pt-2 border-t border-[var(--separator)] mt-1", INK_3)}>
          מציג <span className="tabular-nums">{shown.length}</span> מתוך{" "}
          <span className="tabular-nums">{data.total}</span> התאמות — כדאי לצמצם את החיפוש.
        </p>
      )}
    </div>
  );
}

export function PeopleTab() {
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, isLoading, mutate } = useSWR<PeopleResponse>(
    "/api/radar/people",
    fetcher,
    {
      revalidateOnFocus: true,
      // Poll fast only while something is actually being prepared. A settled list does
      // not need a request every ten seconds, and a failed one will not change on its
      // own — it is waiting for the user to press retry.
      refreshInterval: (latest) =>
        (latest?.people ?? []).some((p) => !p.prep.ready && !p.prep.failed) ? 10_000 : 60_000,
    }
  );

  async function add(contactId: string, retry = false) {
    setBusyId(contactId);
    setError(null);
    try {
      const res = await fetch("/api/radar/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, retry }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(
          body.error === "already_tracked" ? "האיש הזה כבר במעקב." : "ההוספה נכשלה — נסי שוב."
        );
        return;
      }
      setPicking(false);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  if (loadError && !data) {
    return (
      <p className="text-sm text-[var(--danger)] flex items-center gap-1.5 mt-6" role="alert">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {fetchErrorMessage(loadError)}
      </p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={cn("flex items-center gap-2 mt-6", INK_3)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
      </div>
    );
  }

  return (
    <section>
      <p className="text-[17px] font-semibold leading-[1.45]">
        אנשים במעקב בראדאר
        <span className={cn("block mt-1.5 text-[15px] font-normal", INK_3)}>
          לחיצה על אדם פותחת את מה שהמערכת מבינה עליו, מה נשלח לו, ולמה.
        </span>
      </p>

      <div className="flex flex-wrap gap-3 items-center mt-4">
        <Button
          size="sm"
          variant="primary"
          isDisabled={picking}
          onPress={() => setPicking(true)}
        >
          + הוספת איש קשר למעקב
        </Button>
        <span className={cn("text-[12.5px]", INK_3)}>
          בוחרים מרשימת אנשי הקשר — והמערכת עושה את השאר לבד
        </span>
      </div>

      {error && (
        <p className="text-[13px] text-[var(--danger)] mt-2" role="alert">
          {error}
        </p>
      )}

      {picking && (
        <AddPicker
          onPick={(id) => void add(id)}
          onClose={() => setPicking(false)}
          busyId={busyId}
        />
      )}

      {data.people.length === 0 && !picking && (
        <p className={cn("text-sm mt-8", INK_3)}>
          אף אחד לא במעקב עדיין. מוסיפים איש קשר אחד, והמערכת קוראת על החברה שלו ובונה את
          תחומי העניין שלו — ומשם הוא נכנס לסריקות.
        </p>
      )}

      {data.people.map((p, i) =>
        p.prep.ready ? (
          <ReadyCard key={p.contactId} person={p} index={i} />
        ) : (
          <PreparingCard
            key={p.contactId}
            person={p}
            index={i}
            busy={busyId === p.contactId}
            onRetry={() => void add(p.contactId, true)}
          />
        )
      )}
    </section>
  );
}
