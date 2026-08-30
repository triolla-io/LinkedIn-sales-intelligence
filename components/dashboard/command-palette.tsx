"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { GROUPS } from "./sidebar";

/**
 * ⌘K — ניווט וחיפוש.
 *
 * למה: בקנה מידה של 16 אלף אנשי קשר, דפדוף בהיררכיה נשבר. מי שעובד כאן
 * שעות (אריאל, בכיול) צריך להגיע לכל יעד ולכל אדם בלי לעזוב את המקלדת.
 *
 * שתי שכבות בחלון אחד: היעדים תמיד שם, ואנשי קשר נטענים תוך כדי הקלדה
 * מ-/api/contacts/search. אין חיפוש ריק — בלי טקסט מוצגים רק היעדים.
 */

type Person = { id: string; fullName: string; currentTitle: string | null; currentCompany: string | null };

const DESTINATIONS = GROUPS.flatMap((g) => [
  { href: g.href, label: g.label, hint: "מעבר" },
  ...(g.children ?? []).map((c) => ({ href: c.href, label: c.label, hint: g.label })),
]);

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K לפתיחה, Esc לסגירה
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    // פתיחה גם בלחיצה — קיצור מקלדת שאף אחד לא רואה הוא קיצור שלא קיים
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("leadflow:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("leadflow:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setPeople([]);
      setCursor(0);
      // אחרי הפריים שבו המודאל נכנס ל-DOM
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // חיפוש אנשים — עם דיבאונס, ורק ממש כשיש מה לחפש
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setPeople([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/contacts/search?q=${encodeURIComponent(term)}&limit=6`, {
          signal: ctl.signal,
        });
        const body = await r.json();
        setPeople(Array.isArray(body?.contacts) ? body.contacts.slice(0, 6) : []);
      } catch {
        /* בוטל או נכשל — פשוט בלי אנשים */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const dests = useMemo(() => {
    const term = q.trim();
    if (!term) return DESTINATIONS;
    return DESTINATIONS.filter((d) => d.label.includes(term));
  }, [q]);

  const rows = useMemo(
    () => [
      ...dests.map((d) => ({ kind: "dest" as const, href: d.href, label: d.label, sub: d.hint })),
      ...people.map((p) => ({
        kind: "person" as const,
        href: `/contacts?q=${encodeURIComponent(p.fullName)}`,
        label: p.fullName,
        sub: [p.currentTitle, p.currentCompany].filter(Boolean).join(" · "),
      })),
    ],
    [dests, people],
  );

  useEffect(() => setCursor(0), [rows.length]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש ומעבר מהיר"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lift)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
          <Search className="size-4 shrink-0 text-[var(--faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && rows[cursor]) {
                e.preventDefault();
                go(rows[cursor].href);
              }
            }}
            placeholder="לאן, או שם של איש קשר…"
            aria-label="חיפוש"
            className="w-full bg-transparent text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--faint)]"
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              {q.trim().length < 2
                ? "אפשר להקליד שם של מסך או של איש קשר."
                : `אין תוצאה ל״${q.trim()}״.`}
            </p>
          ) : (
            rows.map((r, i) => (
              <button
                key={`${r.kind}-${r.href}-${i}`}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.href)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-start transition-colors",
                  i === cursor ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-secondary)]",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    dir="auto"
                    className={cn(
                      "block truncate text-sm font-semibold bidi-isolate",
                      i === cursor ? "text-[var(--accent)]" : "text-[var(--foreground)]",
                    )}
                  >
                    {r.label}
                  </span>
                  {r.sub && (
                    <span dir="auto" className="block truncate text-xs text-[var(--muted)] bidi-isolate">
                      {r.sub}
                    </span>
                  )}
                </span>
                {i === cursor && <CornerDownLeft className="size-3.5 shrink-0 text-[var(--accent)]" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
