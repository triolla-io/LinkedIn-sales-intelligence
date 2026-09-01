"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import { Button, Input, Switch } from "@heroui/react";
import { Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetcher, fetchErrorMessage } from "@/lib/fetcher";
import type { PackSource, TaxonomyTag } from "@/lib/tech-radar/sources";

/**
 * What the radar reads — as a screen, not as a deploy.
 *
 * Until v3 the radar wrote its own queries and fired them at six paid providers; on
 * 2026-08-31 three of the four were at zero for the month and one employer's research ran
 * on five news items. The replacement is a fixed list of publishers per industry, pulled
 * free by RSS — which makes the LIST the most consequential piece of configuration in the
 * product, and this the screen that owns it.
 *
 * Three things this page is careful about:
 *
 * - **An incomplete pack is normal.** 10 global + 10 Israeli is a target. A new industry
 *   starts short, saves anyway, and scans anyway. The banner says what is missing without
 *   implying anything is broken — because a screen that cries error over a legitimate
 *   state teaches people to ignore it.
 * - **Off is not deleted.** The switch keeps the outlet on screen, so turning it back on
 *   is one click and the record of the decision survives.
 * - **The shared pack forks on first edit.** The chip says which one is on screen; the
 *   server does the forking (see the route), and after a save the pack comes back marked
 *   "מותאם לארגון".
 *
 * Client component: it imports `@/lib/tech-radar/sources` for TYPES only, and that module
 * is deliberately import-free anyway. Nothing prisma-shaped may enter this file — pg
 * pulls in dns/fs/net and `next build` dies (the known trap).
 */

type Pack = {
  id: string;
  industryKey: string;
  label: string;
  scope: "org" | "global";
  sources: PackSource[];
  taxonomy: TaxonomyTag[];
  counts: { global: number; il: number; enabled: number; taxonomy: number };
  incomplete: boolean;
  gaps: string[];
  updatedAt: string;
};

type Payload = { packs: Pack[]; targets: { global: number; il: number } };

const INK_2 = "text-[var(--muted)]";
const INK_3 = "text-[var(--faint)]";

const SCOPE_HE: Record<Pack["scope"], string> = {
  org: "מותאם לארגון",
  global: "החבילה המשותפת",
};

const HALF_HE: Record<PackSource["scope"], string> = {
  global: "מקורות גלובליים",
  il: "מקורות ישראליים",
};

/** Why an edit failed, in words that say what to do next. */
const ERROR_HE: Record<string, string> = {
  source_not_found: "המקור הזה לא נמצא בחבילה — כדאי לרענן את הדף.",
  invalid_sources: "רשימת המקורות לא תקינה — לכל מקור צריך host.",
  invalid_taxonomy: "אוצר המילים לא תקין.",
  not_found: "החבילה לא נמצאה — כדאי לרענן את הדף.",
  unknown_action: "הפעולה לא מוכרת.",
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn("text-xs rounded-full px-[11px] py-[3.5px] border bg-surface border-[var(--line)]", INK_2)}>
      {children}
    </span>
  );
}

/**
 * How this outlet is actually pulled. Worth showing: an unset `rss` is a deliberate
 * choice, not a hole — a guessed feed path fails silently and reads like a quiet week,
 * while the site-restricted Google News feed works on any domain. Someone who knows the
 * real feed URL can see which rows are still on the fallback.
 */
function feedRouteHe(s: PackSource): string {
  if (s.rss) return "פיד ישיר";
  if (s.newsQuery) return `דרך Google News · ${s.newsQuery}`;
  return "דרך Google News";
}

export default function RadarSourcesPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newTag, setNewTag] = useState<Record<string, { tag: string; label: string }>>({});
  const { data, error, isLoading, mutate } = useSWR<Payload>("/api/radar/source-packs", fetcher);

  /** One writer for every edit on the page: the server always answers with the whole
   *  pack, so there is exactly one shape to re-read and no half-updated local copy. */
  async function patch(body: Record<string, unknown>, key: string) {
    if (busy !== null) return false;
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch("/api/radar/source-packs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(ERROR_HE[b.error ?? ""] ?? "השינוי לא נשמר.");
        return false;
      }
      // Re-fetch rather than patch the cache: on the first edit of a shared pack the
      // server forks it, so the row that comes back has a different id and a different
      // scope chip. A hand-patched cache would show the old identity.
      await mutate();
      return true;
    } finally {
      setBusy(null);
    }
  }

  function draftFor(packId: string) {
    return newTag[packId] ?? { tag: "", label: "" };
  }

  function setDraft(packId: string, next: { tag: string; label: string }) {
    setNewTag((prev) => ({ ...prev, [packId]: next }));
  }

  async function addTag(pack: Pack) {
    const draft = draftFor(pack.id);
    const tag = draft.tag.trim();
    const label = draft.label.trim() || tag;
    if (!tag) return;
    if (pack.taxonomy.some((t) => t.tag === tag)) {
      setErr("התגית הזאת כבר באוצר המילים.");
      return;
    }
    const ok = await patch(
      { packId: pack.id, action: "taxonomy", taxonomy: [...pack.taxonomy, { tag, label }] },
      `tag-add-${pack.id}`
    );
    if (ok) setDraft(pack.id, { tag: "", label: "" });
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

  return (
    <div dir="rtl" className="flex-1 min-h-full bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-[880px] mx-auto px-4 sm:px-6 pt-6 pb-20">
        <Link
          href="/routine/radar?tab=people"
          className={cn("inline-flex items-center gap-1 text-[13px] mb-5", INK_3)}
        >
          <ArrowRight className="size-3.5" aria-hidden />
          חזרה לראדאר
        </Link>

        <div className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7">
          <h1 className="text-[20px] font-bold tracking-tight">מקורות הראדאר</h1>
          <p className={cn("text-[13.5px] mt-1", INK_2)}>
            הראדאר קורא רק את המקורות שברשימות האלה. כיבוי או הוספה כאן משפיעים על הסריקה הבאה — בלי
            דיפלוי. המשיכה מהמקורות חינמית, כך שהוספת מקור לא מייקרת שום דבר.
          </p>
          <p className={cn("text-[12.5px] mt-2", INK_3)}>
            היעד לכל תעשייה: {data.targets.global} מקורות גלובליים ו-{data.targets.il} ישראליים. זה
            יעד ולא תנאי — חבילה קצרה נשמרת ופועלת, ורק מסומנת כאן.
          </p>
        </div>

        {err && (
          <p className="text-[12.5px] mt-3 text-[var(--danger)]" role="alert">
            {err}
          </p>
        )}

        {data.packs.length === 0 && (
          <div className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7 mt-5">
            <p className={cn("text-[13.5px]", INK_2)}>
              עוד אין חבילת מקורות. חבילה נוצרת כשאדם ראשון מתעשייה כלשהי נכנס לראדאר — המערכת מזהה
              את התעשייה מהמחקר על המעסיק ובונה לה רשימה, והרשימה מופיעה כאן לעריכה.
            </p>
          </div>
        )}

        {data.packs.map((pack) => {
          const halves: PackSource["scope"][] = ["global", "il"];
          const draft = draftFor(pack.id);
          return (
            <div
              key={pack.id}
              className="bg-surface border border-[var(--separator)] rounded-[20px] p-5 sm:p-7 mt-5"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold">{pack.label}</h2>
                  <p className={cn("text-[12.5px] mt-0.5 tabular-nums", INK_3)}>
                    {pack.counts.global} גלובליים · {pack.counts.il} ישראליים ·{" "}
                    {pack.counts.enabled} פעילים מתוך {pack.sources.length} · {pack.counts.taxonomy}{" "}
                    תגיות סיווג
                  </p>
                </div>
                <span className="ms-auto shrink-0">
                  {/* Which row is on screen. Before the first edit this is the built-in every
                      org shares; the edit forks it, and the chip is how that becomes visible. */}
                  <Chip>{SCOPE_HE[pack.scope]}</Chip>
                </span>
              </div>

              {/* An expected state, not a failure: worded so nobody reads it as an error and
                  nobody reads the pack as finished either. */}
              {pack.incomplete && (
                <div className="mt-3.5 rounded-[14px] border border-[var(--warning)]/30 bg-[var(--warning)]/8 px-4 py-3">
                  <p className="text-[13px] font-semibold text-[var(--warning)]">
                    החבילה עוד לא שלמה — והיא נשמרת ופועלת ככה
                  </p>
                  <ul className={cn("text-[12.5px] mt-1.5 flex flex-col gap-0.5", INK_2)}>
                    {pack.gaps.map((g) => (
                      <li key={g}>· {g}</li>
                    ))}
                  </ul>
                </div>
              )}

              {halves.map((half) => {
                const rows = pack.sources.filter((s) => s.scope === half);
                return (
                  <section key={half} className="mt-4 pt-4 border-t border-[var(--separator)]">
                    <h3 className={cn("text-[12.5px] font-semibold", INK_3)}>
                      {HALF_HE[half]} · {rows.length}/{half === "global" ? data.targets.global : data.targets.il}
                    </h3>
                    {rows.length === 0 ? (
                      <p className={cn("text-[13px] mt-2", INK_3)}>אין מקורות בחצי הזה.</p>
                    ) : (
                      <div className="mt-1.5">
                        {rows.map((s, i) => (
                          <div
                            key={s.host}
                            className={cn(
                              "flex justify-between items-center gap-3 py-2.5 flex-wrap",
                              i < rows.length - 1 && "border-b border-dashed border-[var(--separator)]"
                            )}
                          >
                            <span
                              className={cn(
                                "text-[13.5px] min-w-0 flex items-center gap-1.5 flex-wrap",
                                !s.enabled && "opacity-45"
                              )}
                            >
                              <b className="font-semibold">{s.name}</b>
                              <span className={INK_3} dir="ltr">
                                {s.host}
                              </span>
                              <span className={cn("text-[12px]", INK_3)}>· {feedRouteHe(s)}</span>
                            </span>
                            <span className="shrink-0 flex items-center gap-2">
                              <span className={cn("text-[12px]", INK_3)}>
                                {s.enabled ? "נקרא" : "כבוי"}
                              </span>
                              <Switch
                                size="sm"
                                isSelected={s.enabled}
                                isDisabled={busy !== null}
                                onChange={(v: boolean) =>
                                  void patch(
                                    {
                                      packId: pack.id,
                                      action: "toggleSource",
                                      host: s.host,
                                      enabled: v,
                                    },
                                    `src-${pack.id}-${s.host}`
                                  )
                                }
                                aria-label={`קריאה מ-${s.name}`}
                              >
                                <Switch.Control>
                                  <Switch.Thumb />
                                </Switch.Control>
                              </Switch>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}

              {/* The closed vocabulary. Closedness is the mechanism, not a limitation: free
                  text on both sides fails silently on synonyms, so triage may only echo a
                  tag that appears here. Removing one removes a way for an item to match. */}
              <section className="mt-4 pt-4 border-t border-[var(--separator)]">
                <h3 className={cn("text-[12.5px] font-semibold", INK_3)}>
                  אוצר המילים לסיווג · {pack.taxonomy.length}
                </h3>
                <p className={cn("text-[12px] mt-1", INK_3)}>
                  המערכת מסווגת כל ידיעה לתגיות מהרשימה הזאת בלבד. תגית שלא כאן פשוט לא קיימת מבחינת
                  ההתאמה.
                </p>

                {pack.taxonomy.length === 0 ? (
                  <p className={cn("text-[13px] mt-2", INK_3)}>הרשימה ריקה.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {pack.taxonomy.map((t) => (
                      <span
                        key={t.tag}
                        className={cn(
                          "text-xs rounded-full ps-[11px] pe-1.5 py-[3.5px] border bg-surface border-[var(--line)] flex items-center gap-1.5",
                          INK_2
                        )}
                      >
                        {t.label}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            void patch(
                              {
                                packId: pack.id,
                                action: "taxonomy",
                                taxonomy: pack.taxonomy.filter((x) => x.tag !== t.tag),
                              },
                              `tag-del-${pack.id}-${t.tag}`
                            )
                          }
                          className={cn("px-1 rounded-full disabled:opacity-60", INK_3)}
                          aria-label={`הסרת התגית ${t.label}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-3 flex-wrap">
                  {/* Two fields on purpose. `tag` is the stable key the classifier echoes
                      verbatim and `label` is what a human reads; deriving one from the other
                      would quietly rename a key that items are already tagged with. */}
                  <Input
                    value={draft.tag}
                    onChange={(e) => setDraft(pack.id, { ...draft, tag: e.target.value })}
                    placeholder="מפתח, למשל: תשלומים-מיידיים"
                    aria-label="מפתח התגית"
                    disabled={busy !== null}
                    className="flex-1 min-w-[160px]"
                  />
                  <Input
                    value={draft.label}
                    onChange={(e) => setDraft(pack.id, { ...draft, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addTag(pack);
                    }}
                    placeholder="תווית לקריאה, למשל: תשלומים מיידיים"
                    aria-label="תווית התגית"
                    disabled={busy !== null}
                    className="flex-1 min-w-[160px]"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    isDisabled={busy !== null || draft.tag.trim() === ""}
                    onPress={() => void addTag(pack)}
                  >
                    הוספה
                  </Button>
                </div>
              </section>
            </div>
          );
        })}
      </div>
    </div>
  );
}
