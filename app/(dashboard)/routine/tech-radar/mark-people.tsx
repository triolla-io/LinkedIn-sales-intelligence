"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@heroui/react";
import { Loader2, Plus, X, Search, ExternalLink, AlertTriangle } from "lucide-react";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage, FetchError } from "@/lib/fetcher";

/**
 * Pick the people a run should draft to.
 *
 * This is the input side of a person-first test. Without it the flow is company-first in
 * both directions: you add companies and the system chooses recipients itself from
 * whoever ranks as senior there, so there is no way to say "test these five people".
 *
 * A marked contact bypasses the seniority gate (see lib/tech-radar/create-drafts.ts) —
 * the point of marking someone is that the automatic rule would not have chosen them.
 */

type Person = {
  id: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  linkedinUrl: string | null;
  radarInclude: boolean | null;
};

const MUTED = "text-[var(--muted)]";
const FAINT = "text-[var(--faint)]";

function Row({ p, right }: { p: Person; right: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="text-sm text-[var(--ink-strong)]">{p.fullName}</span>
        {/* The profile link is the only unambiguous identifier — two people share a
            name far more often than they share a LinkedIn URL. */}
        {p.linkedinUrl && (
          <a
            href={p.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex align-middle mx-1 text-[var(--accent)] hover:text-[var(--accent-strong)]"
            aria-label={`פרופיל לינקדאין של ${p.fullName}`}
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        <span className={cn("text-xs", FAINT)}>
          {" — "}
          {p.currentTitle ?? "?"}
          {" @ "}
          {p.currentCompany ?? "?"}
        </span>
      </span>
      {right}
    </li>
  );
}

/**
 * A failed load must not look like an empty result. Before this, a 500 from the marks
 * route rendered as "no contact found by that name" and as "you have not marked anyone
 * yet" — two sentences that describe the data, while the truth was that there was no
 * data. That is what made a working search look broken.
 */
function ErrorNote({ error }: { error: unknown }) {
  return (
    <p className="text-xs text-[var(--danger)] flex items-center gap-1.5" role="alert">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {fetchErrorMessage(error)}
    </p>
  );
}

export function MarkPeople() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [markError, setMarkError] = useState<unknown>(null);

  const marked = useSWR<{ marked: Person[] }>("/api/tech-radar/marks", fetcher, {
    refreshInterval: 0,
  });
  // Only searches once there is something to search for — an empty q would return the
  // marked list from the same route and render it twice.
  const search = useSWR<{ candidates: Person[] }>(
    q.trim() ? `/api/tech-radar/marks?q=${encodeURIComponent(q.trim())}` : null,
    fetcher,
    { refreshInterval: 0 },
  );

  async function setMark(contactId: string, radarInclude: boolean | null) {
    setBusy(contactId);
    setMarkError(null);
    try {
      const res = await fetch("/api/tech-radar/marks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, radarInclude }),
      });
      // The route rejects an out-of-range radarInclude rather than coercing it, so its
      // message is worth showing verbatim — the old code threw this away.
      if (!res.ok) throw new FetchError(res.status, await res.json().then((b) => b?.error ?? null).catch(() => null));
      await Promise.all([marked.mutate(), search.mutate()]);
    } catch (err) {
      setMarkError(err);
    } finally {
      setBusy(null);
    }
  }

  const markedList = marked.data?.marked ?? [];
  const included = markedList.filter((p) => p.radarInclude === true);
  const excluded = markedList.filter((p) => p.radarInclude === false);
  const markedIds = new Set(markedList.map((p) => p.id));

  return (
    <div className={cn(ui.card, "p-4")} dir="rtl">
      <h2 className={cn(ui.sectionTitle, "mb-1")}>אנשים לבדיקה</h2>
      <p className={cn("text-xs mb-3", MUTED)}>
        הריצה תשלח למי שסימנת כאן — גם אם התפקיד שלו לא בכיר — במקום למי שהמערכת הייתה
        בוחרת לבד.
      </p>

      <label className={ui.label} htmlFor="tr-mark-q">חיפוש לפי שם או חברה</label>
      <div className="relative">
        <Search className={cn("size-4 absolute top-2.5 start-3", FAINT)} aria-hidden />
        <input
          id="tr-mark-q"
          className={cn(ui.input, "ps-9")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="דנה כהן / Personetics"
        />
      </div>

      {q.trim() && (
        <div className="mt-2">
          {search.error ? (
            <ErrorNote error={search.error} />
          ) : search.isLoading ? (
            <p className={cn("text-xs", FAINT)}>מחפש…</p>
          ) : (search.data?.candidates ?? []).length === 0 ? (
            <p className={cn("text-xs", FAINT)}>לא נמצא אף איש קשר בשם או בחברה הזאת.</p>
          ) : (
            <ul className="divide-y divide-[var(--separator)]">
              {(search.data?.candidates ?? []).map((p) => (
                <Row
                  key={p.id}
                  p={p}
                  right={
                    markedIds.has(p.id) ? (
                      <span className={cn("text-xs shrink-0", FAINT)}>
                        {p.radarInclude === true ? "מסומן" : "מוחרג"}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        className={cn(ui.btnSecondary, "shrink-0")}
                        isDisabled={busy === p.id}
                        onPress={() => setMark(p.id, true)}
                      >
                        {busy === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Plus className="size-3.5" />
                        )}
                        סמן
                      </Button>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4">
        {marked.error && <ErrorNote error={marked.error} />}
        {markError != null && <ErrorNote error={markError} />}
        {!marked.error && (
        <p className={cn("text-xs mb-1", MUTED)}>
          {included.length > 0
            ? `${included.length} אנשים לבדיקה`
            : "עוד לא סימנת אף אחד. חפשי שם או חברה למעלה ולחצי «סמן». בלי סימונים, הריצה תיפול חזרה לכלל האוטומטי."}
        </p>
        )}
        {included.length > 0 && (
          <ul className="divide-y divide-[var(--separator)]">
            {included.map((p) => (
              <Row
                key={p.id}
                p={p}
                right={
                  <Button
                    size="sm"
                    className={cn(ui.btnGhost, "shrink-0")}
                    isDisabled={busy === p.id}
                    onPress={() => setMark(p.id, null)}
                    aria-label={`הסר סימון מ${p.fullName}`}
                  >
                    {busy === p.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </div>

      {excluded.length > 0 && (
        <p className={cn("text-xs mt-3", FAINT)}>
          {excluded.length} אנשי קשר מוחרגים — הם לא יקבלו הודעה בשום מצב.
        </p>
      )}
    </div>
  );
}
