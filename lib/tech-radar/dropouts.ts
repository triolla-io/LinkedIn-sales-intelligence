/**
 * The rejects of a radar run, kept as evidence.
 *
 * Until now an item that failed a floor left no trace: `upsertTechItem` runs on
 * survivors only, so the pool's losers were dropped on the floor of a function that had
 * already returned. That is why the v3 spec's part 3 note says the thresholds cannot be
 * calibrated — asking "would `shareworthy >= 0.55` have let a real gift through?" has no
 * data to answer from, because the 0.55-0.59 items were never written down. Every
 * argument about the bar so far (2026-08-20's eleven vendor launches, 2026-08-24's
 * "0 נמצאו" that turned out to be 25 silently title-filtered people) had to be
 * reconstructed by re-running the pipeline, and a re-run is not the same run.
 *
 * Pure by design: no prisma import (this module is in the client-safe half of
 * lib/tech-radar — see types.ts), no LLM, no clock. It builds the rows; the caller does
 * one `createMany`. That also makes the cap and its ordering testable without a DB.
 */
import type { ItemKind } from "@/lib/tech-radar/types";

/**
 * Which gate rejected the item. A CLOSED set, for the same reason the taxonomy is
 * closed: this table is read by hand-written calibration queries, and free-form labels
 * would have those queries silently miss "shareworthy" spelled three ways — exactly the
 * synonym failure fit.ts's text overlap already demonstrates.
 *
 * "unknown" is the `asKind` discipline: an unrecognised label is NOT mapped onto a real
 * floor, because a calibration query that reads a mislabelled floor reaches the wrong
 * conclusion with full confidence. The raw label survives in `reason`, so nothing is
 * lost and the mismatch is visible the first time someone looks.
 */
export const DROPOUT_FLOORS = [
  /** Freshness gate: no publish date, or older than the 30-day window. */
  "freshness",
  /** Floor 0: the item's industry pack is not this person's industry. */
  "industry",
  /** Floor 0: a business line the person explicitly does NOT own (Pazit and capital markets). */
  "not_owns",
  /** Floor 0: geography vs audience — the Philippine retail-bank feature. */
  "geography",
  /** Triage: below SHAREWORTHY_FLOOR. */
  "shareworthy",
  /** Triage: below STATURE_FLOOR — on topic, no gift in it. */
  "stature",
  /** Triage: everyone in the field has already seen it. */
  "staleness",
  /** Floor 1: no entity hit, no focused tag, and not enough broad tags. */
  "tag_overlap",
  /** Floor 2: the per-person chooser did not pick it. */
  "chooser",
  /** Floor 3: the Opus veto refused it. */
  "veto",
  "unknown",
] as const;

export type DropoutFloor = (typeof DROPOUT_FLOORS)[number];

/**
 * A triage verdict, as much of one as exists.
 *
 * Deliberately a loose superset of the score fields rather than `TriageVerdict` itself:
 * a real verdict is assignable as-is, and `title` can be merged in by the caller, which
 * holds the `PoolItem` the verdict was made about. Triage keys on url and carries no
 * title of its own — and a dropout row without a readable title is a row nobody can
 * calibrate anything from.
 */
export type DropoutVerdict = {
  url: string;
  shareworthy: number;
  stature: number;
  title?: string | null;
  kind?: ItemKind;
  publisher?: string | null;
};

/**
 * What one gate decided about one item, optionally for one person.
 *
 * `pass: true` rows are ignored — survivors already become TechItem/AxisMatch rows, and
 * writing them here too would make this a copy of the pool instead of the reject list.
 *
 * `contactId` because the floors run PER PERSON: the same article legitimately falls
 * twice in one run, once for Pazit on `not_owns` and once for Erez on `tag_overlap`, and
 * both facts are evidence. `title` because floor 0 runs BEFORE triage — that is the
 * point of it, no LLM is paid for a Philippine retail-bank feature — so for those rows
 * the pool item is the only source of a title, and of nothing else.
 */
export type DropoutFloorResult = {
  url: string;
  pass: boolean;
  /** A member of DROPOUT_FLOORS; anything else lands on "unknown" and is kept in `reason`. */
  floor?: string | null;
  /** Free text detail: the score that missed, the notOwns term that hit, the country. */
  reason?: string | null;
  contactId?: string | null;
  title?: string | null;
};

/** One `RadarDropout` row, ready for `createMany`. */
export type RadarDropoutRow = {
  runId: string;
  contactId: string | null;
  url: string;
  host: string;
  title: string;
  /** Null, not 0, when the item never reached triage: floor 0 rejects are unscored, and
   *  0 would be indistinguishable from a genuine 0.0 verdict in the calibration query. */
  shareworthy: number | null;
  stature: number | null;
  floor: DropoutFloor;
  reason: string | null;
};

/**
 * Rows kept per run.
 *
 * The floors run per (item x person), so an org with 8 tracked people and a 200-item
 * pool can reject ~1,600 pairs in one weekly scan, and almost all of them are obvious
 * rubbish. The cap is what stops one bad week — a mis-seeded source pack, a pool full of
 * press releases — from burying the interesting rows under tens of thousands of boring
 * ones.
 */
export const DEFAULT_MAX_DROPOUTS_PER_RUN = 300;

function maxRows(): number {
  const raw = process.env.RADAR_MAX_DROPOUTS_PER_RUN;
  const n = raw === undefined ? Number.NaN : Number(raw);
  // A typo'd env var must not silently switch the evidence off. Ignore it and keep the
  // default: too many rows is a tidying problem, zero rows is the problem this fixes.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_DROPOUTS_PER_RUN;
}

/** Same discipline as source-quality.ts's hostOf: a bare host is still a HOST, and a
 *  string that is not URL-shaped at all loses its path rather than the whole row. */
function hostOf(url: string): string {
  const trimmed = url.trim();
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${trimmed}`).hostname.toLowerCase();
    } catch {
      return trimmed.split(/[/?#]/)[0]?.toLowerCase() ?? "";
    }
  }
}

function asFloor(v: unknown): DropoutFloor {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (DROPOUT_FLOORS as readonly string[]).includes(s) ? (s as DropoutFloor) : "unknown";
}

function joinReason(reason: string | null | undefined, rawFloor: unknown): string | null {
  const parts: string[] = [];
  // The label the caller actually used, kept whenever it did not resolve — otherwise the
  // "unknown" rows are a dead end and the wiring bug behind them is invisible.
  if (typeof rawFloor === "string" && rawFloor.trim() && asFloor(rawFloor) === "unknown") {
    parts.push(`floor="${rawFloor.trim()}"`);
  }
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r) parts.push(r);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Build the `RadarDropout` rows for one run. Pure — the caller writes them.
 *
 * Ordering under the cap is not arbitrary: rows are kept HIGHEST-SCORING FIRST, because
 * the rows that decide whether a threshold should move are the ones that only just
 * failed. A cap that kept a random 300 would answer nothing, which is the mistake this
 * whole table exists to stop making. Unscored (pre-triage) rejects sort last for the
 * same reason — they carry no score to argue about.
 */
export function buildDropoutRows(
  runId: string,
  verdicts: readonly DropoutVerdict[],
  floorResults: readonly DropoutFloorResult[]
): RadarDropoutRow[] {
  const byUrl = new Map<string, DropoutVerdict>();
  for (const v of verdicts) {
    const url = (v?.url ?? "").trim();
    if (url && !byUrl.has(url)) byUrl.set(url, v);
  }

  const rows: RadarDropoutRow[] = [];
  // One row per (url, person). A second rejection of the same pair is a later floor
  // that never actually saw the item, so the FIRST one is the true cause of death.
  const seen = new Set<string>();

  for (const r of floorResults) {
    if (!r || r.pass) continue;
    const url = (r.url ?? "").trim();
    if (!url) continue;
    const contactId = r.contactId?.trim() || null;
    const key = `${url} ${contactId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const v = byUrl.get(url);
    rows.push({
      runId,
      contactId,
      url,
      host: hostOf(url),
      title: (r.title ?? "").trim() || (v?.title ?? "").trim() || url,
      shareworthy: typeof v?.shareworthy === "number" ? v.shareworthy : null,
      stature: typeof v?.stature === "number" ? v.stature : null,
      floor: asFloor(r.floor),
      reason: joinReason(r.reason, r.floor),
    });
  }

  const cap = maxRows();
  if (rows.length <= cap) return rows;

  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const sa = (a.row.shareworthy ?? -1) + (a.row.stature ?? -1);
      const sb = (b.row.shareworthy ?? -1) + (b.row.stature ?? -1);
      // Stable on ties, so a re-run of the same pool keeps the same rows.
      return sb - sa || a.i - b.i;
    })
    .slice(0, cap)
    .map(({ row }) => row);
}
