/**
 * Deterministic per-person ranking, and the send-release gate. Zero LLM calls.
 *
 * Ranking decides who is a CANDIDATE and in what order the veto sees them. It never
 * decides who receives anything — that is the veto's job, and keeping the two separate
 * is what stops "the axis matched" from silently becoming "so we sent it".
 *
 * PACING LIVES AT THE BOTTOM OF THIS FILE, NOT IN rankForPeople. Until 2026-09-01 the
 * 7-day rule ran as filter #2 of the ranking: a candidate whose person had been messaged
 * four days ago was dropped as `too_soon`, and since a decided (contactId, itemId) pair
 * is never re-judged, a genuinely good article was thrown away because an unrelated
 * message went out on Tuesday. Pacing is a SEND concern: everything that clears the
 * floors becomes a draft, and `evaluateRelease` withholds it — with a reason — until the
 * person's window opens. See docs/superpowers/specs/2026-08-31-radar-relevance-redesign-design.md
 * part 4.
 *
 * Pure and prisma-free (the route and judgeAndDraft both import it, and a client
 * component may read its copy), and every ordering is total, so an Inngest step replay
 * produces the same list.
 */
import { FRESHNESS_WINDOW_DAYS } from "@/lib/tech-radar/freshness";

export type RankCandidate = {
  contactId: string;
  itemId: string;
  axisId: string;
  trackedCompanyId: string;
  /** The shared (axis, item) score. */
  axisScore: number;
  /** This person's weight on that axis. */
  personWeight: number;
  /** `kind` of the item, for the diversity rule. */
  kind: string;
};

export type RankInput = {
  candidates: RankCandidate[];
  /** (contactId, itemId) pairs this person has already been sent or drafted. */
  alreadySeen: Set<string>;
  /** contactId -> the kinds of their last three drafts, most recent first. */
  recentKinds: Map<string, string[]>;
  limit: number;
};

export type RankDrop = { candidate: RankCandidate; reason: string };
export type RankResult = { ranked: RankCandidate[]; dropped: RankDrop[] };

export function pairKey(contactId: string, itemId: string): string {
  return `${contactId}::${itemId}`;
}

/**
 * 0.15 per matching kind among the last three. Two in a row is discouraged; three in a
 * row is impossible, because the third match makes the penalty 0.45 — larger than the
 * gap any real score difference produces.
 */
export function diversityPenalty(kind: string, recent: string[] | undefined): number {
  if (!recent || recent.length === 0) return 0;
  const matches = recent.slice(0, 3).filter((k) => k === kind).length;
  return 0.15 * matches;
}

export function confidenceOf(c: RankCandidate, recentKinds: Map<string, string[]>): number {
  return c.axisScore * c.personWeight - diversityPenalty(c.kind, recentKinds.get(c.contactId));
}

/**
 * Five filters in order, then selection. Every drop carries a reason: a candidate count
 * that shrinks with nothing recorded is the silent-filtering failure this codebase has
 * now hit three times.
 *
 * Pacing is deliberately NOT one of them — see the file header and `evaluateRelease`.
 */
export function rankForPeople(input: RankInput): RankResult {
  const dropped: RankDrop[] = [];
  const survivors: RankCandidate[] = [];

  for (const c of input.candidates) {
    // 1. Never the same item twice to the same person. Also enforced by a DB unique
    //    index; this is the cheap check that avoids reaching it.
    if (input.alreadySeen.has(pairKey(c.contactId, c.itemId))) {
      dropped.push({ candidate: c, reason: "already_seen" });
      continue;
    }
    // 2. Diversity as a hard rule, not only a penalty: three of the same kind in a row
    //    makes a person a topic feed rather than someone you thought of.
    const recent = input.recentKinds.get(c.contactId) ?? [];
    if (recent.length >= 3 && recent.slice(0, 3).every((k) => k === c.kind)) {
      dropped.push({ candidate: c, reason: "kind_fatigue" });
      continue;
    }
    survivors.push(c);
  }

  // 3. One candidate per person per run. The veto is expensive and a person can receive
  //    at most one thing anyway, so offering it two candidates for the same person wastes
  //    a call and risks two drafts.
  const bestPerPerson = new Map<string, RankCandidate>();
  for (const c of survivors) {
    const held = bestPerPerson.get(c.contactId);
    if (!held) {
      bestPerPerson.set(c.contactId, c);
      continue;
    }
    const a = confidenceOf(c, input.recentKinds);
    const b = confidenceOf(held, input.recentKinds);
    // Total order: score, then itemId, then axisId — so a replay cannot reorder.
    const better =
      a > b || (a === b && (c.itemId < held.itemId || (c.itemId === held.itemId && c.axisId < held.axisId)));
    if (better) {
      bestPerPerson.set(c.contactId, c);
      dropped.push({ candidate: held, reason: "outranked_for_person" });
    } else {
      dropped.push({ candidate: c, reason: "outranked_for_person" });
    }
  }

  const ordered = [...bestPerPerson.values()].sort((x, y) => {
    const d = confidenceOf(y, input.recentKinds) - confidenceOf(x, input.recentKinds);
    if (d !== 0) return d;
    if (x.itemId !== y.itemId) return x.itemId < y.itemId ? -1 : 1;
    if (x.contactId !== y.contactId) return x.contactId < y.contactId ? -1 : 1;
    return x.axisId < y.axisId ? -1 : 1;
  });

  const ranked = ordered.slice(0, Math.max(0, input.limit));
  for (const c of ordered.slice(Math.max(0, input.limit))) {
    dropped.push({ candidate: c, reason: "over_run_limit" });
  }

  return { ranked, dropped };
}

// ─── The send-release gate ────────────────────────────────────────────────────
//
// Two rules, both evaluated at RELEASE time — the moment a human asks us to put a draft
// in front of them — and never at creation time.

/**
 * Days between two messages to the same person.
 *
 * The CANONICAL copy. MUST equal QUIET_COOLDOWN_DAYS in lib/tech-radar/quiet.ts, which
 * stays prisma-free and derives the "בהמתנה" copy from the same number. (person-scan.ts
 * used to carry a third copy that nothing read; it was removed in Phase B, when pacing
 * moved from ranking to `evaluateRelease` below.) A radar with no ask has no right to be
 * frequent.
 */
export const MIN_DAYS_BETWEEN_MESSAGES = 7;

/** The `discardReason` written on a draft that aged out while it queued. */
export const STALE_IN_QUEUE_REASON = "stale_in_queue";

export type ReleaseInput = {
  /**
   * Publication date of the article the draft is built on. Null means the item never
   * proved a date — see the null branch of `evaluateRelease` for why that does NOT close it.
   */
  itemPublishedAt: Date | null;
  /** The last time anything actually went out to this person. Null means never. */
  lastMessageAt: Date | null;
  now: Date;
  minDaysBetweenMessages?: number;
  freshnessWindowDays?: number;
};

/**
 * Three outcomes, and the two that stop always carry Hebrew a human can read on screen.
 * A stop with no reason is the silent-SKIP failure this codebase has a standing rule
 * against — so the reason is part of the type, not an optional extra.
 */
export type ReleaseVerdict =
  | { action: "release" }
  | { action: "withhold"; reason: "pacing"; daysSinceLastMessage: number; daysUntilOpen: number; hebrew: string }
  | { action: "close"; reason: typeof STALE_IN_QUEUE_REASON; ageDays: number; hebrew: string };

const DAY_MS = 86_400_000;

/** Gender-neutral by construction: the copy describes the draft, never addresses a person. */
function daysHe(n: number): string {
  if (n === 1) return "יום אחד";
  if (n === 2) return "יומיים";
  return `${n} ימים`;
}

export function evaluateRelease(input: ReleaseInput): ReleaseVerdict {
  const minDays = input.minDaysBetweenMessages ?? MIN_DAYS_BETWEEN_MESSAGES;
  const window = input.freshnessWindowDays ?? FRESHNESS_WINDOW_DAYS;

  // 1. Aged out in the queue. Checked FIRST because it is terminal: withholding something
  //    that can never be sent would leave it waiting forever.
  if (input.itemPublishedAt) {
    const ageDays = Math.floor((input.now.getTime() - input.itemPublishedAt.getTime()) / DAY_MS);
    if (ageDays > window) {
      return {
        action: "close",
        reason: STALE_IN_QUEUE_REASON,
        ageDays,
        hebrew: `התיישנה בתור — הכתבה מלפני ${daysHe(ageDays)}, מעבר לחלון של ${window} יום`,
      };
    }
  }
  // An item with no date is NOT closed here. The ingest freshness gate is the place that
  // rejects undated items; rows that predate that gate still exist, and deleting one on a
  // date we never had would be the same silent drop from the other direction. It reaches
  // the reviewer, who can see the missing date on the card.

  // 2. Pace.
  if (input.lastMessageAt) {
    const elapsed = (input.now.getTime() - input.lastMessageAt.getTime()) / DAY_MS;
    if (elapsed < minDays) {
      const daysSinceLastMessage = Math.max(0, Math.floor(elapsed));
      const daysUntilOpen = Math.max(1, Math.ceil(minDays - elapsed));
      const sent = daysSinceLastMessage === 0 ? "נשלחה הודעה היום" : `נשלחה הודעה לפני ${daysHe(daysSinceLastMessage)}`;
      return {
        action: "withhold",
        reason: "pacing",
        daysSinceLastMessage,
        daysUntilOpen,
        hebrew: `${sent} — הטיוטה ממתינה בתור ותשוחרר בעוד ${daysHe(daysUntilOpen)}`,
      };
    }
  }

  return { action: "release" };
}
