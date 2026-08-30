"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button, Switch, TextArea } from "@heroui/react";
import { Loader2, AlertTriangle, Search, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useRoutineModules } from "@/lib/hooks/use-routine-modules";

/**
 * "תגובות לפוסטים" — the contract this screen must honor honestly: clicking
 * "פתח בלינקדאין לשליחה" never posts anything. It types the comment into a LinkedIn tab
 * and hands the tab to the user, who presses LinkedIn's own submit button herself, then
 * comes back and confirms "נשלח ✓". The copy below is written to never claim otherwise.
 *
 * Shape and idiom copied from the two reviewed sibling screens: the draft-card / prepare
 * → "נשלח ✓" two-step and 422-guard handling from radar/approvals-tab.tsx, and the
 * debounced add-picker from radar/people-tab.tsx. Both use bare `bg-[var(--...)]` +
 * `cn()` styling rather than components/ui/*, which this file follows.
 */

const INK_2 = "text-[var(--muted)]";
const INK_3 = "text-[var(--faint)]";
const AVATAR_BG = ["#5b7a9d", "#8a6d54", "#7d8b9a", "#6d8a70"];

type Person = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  linkedinUrl: string;
};
type PeopleResponse = { marked: Person[]; matches: Person[] };

type DraftStatus = "PENDING_REVIEW" | "PREPARING" | "PREPARED";
type Draft = {
  id: string;
  status: DraftStatus;
  commentText: string;
  createdAt: string;
  sentAt: string | null;
  post: { postUrl: string; text: string; postedAt: string | null; postedAgoText: string | null };
  contact: { id: string; fullName: string; currentTitle: string | null; currentCompany: string | null; linkedinUrl: string };
};
type DraftsResponse = { drafts: Draft[] };

/** Hebrew text for enforceCommentRules' violation codes (lib/post-comments/draft.ts). */
const GUARD_HE: Record<string, string> = {
  too_long: "התגובה ארוכה מדי — קצרו אותה",
  emoji: "בלי אימוג'ים בתגובות לפוסטים",
  exclamations: "אפשר סימן קריאה אחד לכל היותר",
  url: "אסור לשים קישור בתגובה",
  banned_word: "יש בתגובה מילה שלא מתאימה לטון — נסחו מחדש",
  empty: "התגובה ריקה",
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
}

/** On/off switch for the page header — same pattern as the other routine modules. */
export function PostCommentsModuleSwitch() {
  const { modules, setModule } = useRoutineModules();
  if (!modules) return null;
  const on = modules.postCommentsEnabled ?? false;
  return (
    <div className="flex items-center gap-2" dir="rtl">
      <span className={cn("text-xs font-medium", on ? "text-[var(--success)]" : "text-[var(--warning)]")}>
        {on ? "המודול פעיל" : "המודול כבוי"}
      </span>
      <Switch
        size="sm"
        isSelected={on}
        onChange={(v: boolean) => setModule("postComments", v)}
        aria-label="הפעלת מודול תגובות לפוסטים"
      >
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch>
    </div>
  );
}

/* ---------------------------- People section ---------------------------- */

function PersonChip({ person, onRemove, busy }: { person: Person; onRemove: () => void; busy: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-surface pe-1 ps-3 py-1 text-[13px]">
      <span dir="auto" className="bidi-isolate">
        {person.fullName}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={`הפסקת מעקב אחרי ${person.fullName}`}
        className={cn(
          "grid size-5 place-items-center rounded-full hover:bg-[var(--surface-secondary)] disabled:opacity-50",
          INK_3
        )}
      >
        {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <X className="size-3" aria-hidden />}
      </button>
    </span>
  );
}

function AddPersonPicker({ onPick, onClose, busyId }: { onPick: (id: string) => void; onClose: () => void; busyId: string | null }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 300);

  // Searched server-side (same reasoning as radar's AddPicker): with thousands of
  // contacts, filtering a page of them in the browser means most people can't be found.
  const { data, isLoading } = useSWR<PeopleResponse>(
    `/api/post-comments/people?q=${encodeURIComponent(debounced)}`,
    fetcher,
    { keepPreviousData: true }
  );
  const shown = debounced ? data?.matches ?? [] : [];

  return (
    <div className="bg-surface border border-[var(--line)] rounded-[16px] p-4 mt-3">
      <div className="flex items-center gap-2">
        <Search className={cn("size-4 shrink-0", INK_3)} aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי שם, תפקיד או חברה"
          aria-label="חיפוש איש קשר להוספה למעקב"
          className="flex-1 bg-transparent border-0 outline-none text-[14px] py-1"
        />
        <button type="button" onClick={onClose} aria-label="סגירה" className={INK_3}>
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 max-h-[280px] overflow-y-auto">
        {!debounced ? (
          <p className={cn("text-[13px] py-3", INK_3)}>הקלידו שם, תפקיד או חברה כדי לחפש באנשי הקשר שלכם.</p>
        ) : shown.length === 0 ? (
          <p className={cn("text-[13px] py-3", INK_3)}>
            {isLoading ? "מחפש…" : "אין איש קשר שמתאים לחיפוש הזה, או שכולם כבר במעקב."}
          </p>
        ) : (
          shown.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => onPick(c.id)}
              className="w-full text-right flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-[var(--surface-secondary)] disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block text-[14px] font-semibold truncate bidi-isolate">
                  {c.fullName}
                </span>
                <span className={cn("block text-[12.5px] truncate", INK_3)}>
                  {[c.currentTitle, c.currentCompany].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              {busyId === c.id && <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function PeopleSection() {
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: loadError, isLoading, mutate } = useSWR<PeopleResponse>("/api/post-comments/people", fetcher);

  async function toggle(contactId: string, value: boolean) {
    setBusyId(contactId);
    setError(null);
    try {
      const res = await fetch("/api/post-comments/people", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, value }),
      });
      if (!res.ok) {
        setError(value ? "המעקב לא נוסף — נסו שוב." : "הסרת המעקב נכשלה — נסו שוב.");
        return;
      }
      if (value) setPicking(false);
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  if (loadError && !data) {
    return (
      <p className="text-sm text-[var(--danger)] flex items-center gap-1.5" role="alert">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {fetchErrorMessage(loadError)}
      </p>
    );
  }

  const marked = data?.marked ?? [];

  return (
    <section>
      <h2 className="type-h2 text-[15px]">אנשים במעקב</h2>
      <p className={cn("text-[13.5px] mt-1", INK_3)}>
        המערכת בודקת כל בוקר אם מישהו מהם פרסם, ומכינה תגובה קצרה לאישור שלכם.
      </p>

      <div className="flex flex-wrap gap-2 items-center mt-3">
        {isLoading && !data ? (
          <span className={cn("inline-flex items-center gap-1.5 text-[13px]", INK_3)}>
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> טוען…
          </span>
        ) : marked.length === 0 ? (
          <span className={cn("text-[13px]", INK_3)}>אף אחד לא במעקב עדיין.</span>
        ) : (
          marked.map((p) => <PersonChip key={p.id} person={p} busy={busyId === p.id} onRemove={() => void toggle(p.id, false)} />)
        )}
        <Button size="sm" variant="secondary" isDisabled={picking} onPress={() => setPicking(true)}>
          + הוספת איש קשר למעקב
        </Button>
      </div>

      {error && (
        <p className="text-[13px] text-[var(--danger)] mt-2" role="alert">
          {error}
        </p>
      )}

      {picking && (
        <AddPersonPicker onPick={(id) => void toggle(id, true)} onClose={() => setPicking(false)} busyId={busyId} />
      )}
    </section>
  );
}

/* ----------------------------- Drafts feed ------------------------------ */

const POST_CLAMP_CHARS = 220;

function DraftCard({ draft, index, onChanged }: { draft: Draft; index: number; onChanged: () => void }) {
  const [text, setText] = useState(() => draft.commentText);
  const [busy, setBusy] = useState<null | "save" | "prepare" | "sent" | "dismiss">(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const dirty = text !== draft.commentText;
  const pending = draft.status === "PENDING_REVIEW";

  async function patch(body: Record<string, unknown>, kind: NonNullable<typeof busy>) {
    setBusy(kind);
    setViolations([]);
    try {
      const res = await fetch(`/api/post-comments/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { violations?: string[]; error?: string };
      if (res.status === 422 && Array.isArray(data.violations)) {
        setViolations(data.violations);
        return false;
      }
      if (!res.ok) {
        setViolations([data.error === "not_pending" || data.error === "not_prepared" ? "הטיוטה כבר בטיפול — רענן את העמוד" : "משהו נכשל — נסו שוב"]);
        return false;
      }
      onChanged();
      return true;
    } catch {
      setViolations(["שגיאת רשת — נסו שוב"]);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="bg-surface border border-[var(--line)] rounded-[var(--radius-card)] p-5 sm:p-6 mt-5 shadow-[var(--shadow-paper)]">
      {/* who + when */}
      <div className="flex items-center gap-3.5">
        <div
          className="w-[44px] h-[44px] rounded-full grid place-items-center text-white font-bold shrink-0"
          style={{ backgroundColor: AVATAR_BG[index % AVATAR_BG.length] }}
          aria-hidden
        >
          {initials(draft.contact.fullName)}
        </div>
        <div className="min-w-0">
          <a
            href={draft.contact.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            dir="auto"
            className="font-bold text-[15.5px] hover:underline bidi-isolate"
          >
            {draft.contact.fullName}
          </a>
          <div dir="auto" className={cn("text-[13px] bidi-isolate", INK_3)}>
            {[draft.contact.currentTitle, draft.contact.currentCompany].filter(Boolean).join(" · ")}
          </div>
        </div>
        {draft.post.postedAgoText && (
          <span className={cn("ms-auto shrink-0 text-[12.5px]", INK_3)}>{draft.post.postedAgoText}</span>
        )}
      </div>

      {/* the post the comment reacts to */}
      <div className="mt-4 bg-[var(--surface-secondary)] rounded-[14px] px-4 py-3">
        <p dir="auto" className={cn("text-[14px] leading-[1.6] whitespace-pre-wrap bidi-isolate", !expanded && "line-clamp-4")}>
          {draft.post.text}
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          {draft.post.text.length > POST_CLAMP_CHARS && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-[12.5px] text-[var(--brand-linkedin)] hover:underline"
            >
              {expanded ? "הצג פחות" : "הצג עוד"}
            </button>
          )}
          <a
            href={draft.post.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12.5px] text-[var(--brand-linkedin)] hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden /> הצגת הפוסט בלינקדאין
          </a>
        </div>
      </div>

      {/* the editable comment — what you see is what gets typed into LinkedIn */}
      <div className="mt-4">
        <TextArea
          aria-label={`התגובה לפוסט של ${draft.contact.fullName}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!pending || busy !== null}
          className="w-full"
          dir="rtl"
        />
      </div>

      {violations.length > 0 && (
        <p className="text-[13px] text-[var(--danger)] mt-2" role="alert">
          {violations.map((v) => GUARD_HE[v] ?? v).join(" · ")}
        </p>
      )}

      {/* actions, by status */}
      <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-4 border-t border-[var(--separator)]">
        {pending ? (
          <>
            <Button
              size="sm"
              variant="primary"
              className="bg-[var(--brand-linkedin)]"
              isDisabled={busy !== null || !text.trim()}
              onPress={() => void patch({ action: "prepare", comment: text }, "prepare")}
            >
              {busy === "prepare" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              פתח בלינקדאין לשליחה
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy !== null || !text.trim()}
                onPress={() => void patch({ action: "save", comment: text }, "save")}
              >
                {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                שמירה
              </Button>
            )}
            <button
              type="button"
              onClick={() => void patch({ action: "dismiss", reason: "not_relevant" }, "dismiss")}
              disabled={busy !== null}
              className={cn("text-sm ms-auto disabled:opacity-50", INK_3)}
            >
              {busy === "dismiss" ? "מסיר…" : "לא רלוונטי ›"}
            </button>
          </>
        ) : (
          <>
            <span className={cn("text-[13.5px]", INK_2)}>
              {draft.status === "PREPARING"
                ? "התגובה נפתחת בלינקדאין…"
                : "התגובה מוכנה בלינקדאין — אחרי ששלחת, אשר כאן."}
            </span>
            <Button
              size="sm"
              variant="primary"
              className="bg-[var(--brand-linkedin)] ms-auto"
              isDisabled={busy !== null}
              onPress={() => void patch({ action: "sent" }, "sent")}
            >
              {busy === "sent" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              נשלח ✓
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

function DraftsFeed() {
  const { data, error, isLoading, mutate } = useSWR<DraftsResponse>("/api/post-comments", fetcher, {
    // Fast polling only while something is actually in flight — a status flip that
    // happens server-side (the extension finishing PREPARING -> PREPARED) must reach
    // this screen without a manual refresh; a settled feed doesn't need it as often.
    refreshInterval: (latest) =>
      (latest?.drafts ?? []).some((d) => d.status === "PREPARING" || d.status === "PREPARED") ? 10_000 : 60_000,
    revalidateOnFocus: true,
  });

  if (error && !data) {
    return (
      <p className="text-sm text-[var(--danger)] flex items-center gap-1.5 mt-4" role="alert">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {fetchErrorMessage(error)}
      </p>
    );
  }
  if (isLoading || !data) {
    return (
      <div className={cn("flex items-center gap-2 mt-4", INK_3)}>
        <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
      </div>
    );
  }

  if (data.drafts.length === 0) {
    return (
      <p className={cn("text-sm mt-4", INK_3)}>
        אין עדיין טיוטות תגובה. ברגע שמישהו מהאנשים במעקב מפרסם, תגובה קצרה תופיע כאן לאישור שלכם.
      </p>
    );
  }

  return (
    <div>
      {data.drafts.map((d, i) => (
        <DraftCard key={d.id} draft={d} index={i} onChanged={() => void mutate()} />
      ))}
    </div>
  );
}

/* -------------------------------- Root ---------------------------------- */

export function PostCommentsClient() {
  const { modules } = useRoutineModules();
  const on = modules?.postCommentsEnabled ?? false;

  return (
    <div className="flex-1 p-5 sm:p-7" dir="rtl">
      {modules && !on && (
        <div className="mb-5 px-4 py-2.5 rounded-lg bg-[var(--warning-soft)] border border-[var(--warning-soft)] text-xs text-[var(--warning)]">
          המודול כבוי — הסריקה היומית של פוסטים חדשים לא רצה, אבל עדיין אפשר לנהל מי במעקב ולסקור תגובות שכבר הוכנו.
        </div>
      )}

      <PeopleSection />

      <div className="mt-10 pt-6 border-t border-[var(--line)]">
        <h2 className="type-h2 text-[15px]">תגובות ממתינות</h2>
        <DraftsFeed />
      </div>
    </div>
  );
}
