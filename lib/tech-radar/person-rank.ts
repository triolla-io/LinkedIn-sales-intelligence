/**
 * Deterministic per-person ranking. Zero LLM calls.
 *
 * This decides who is a CANDIDATE and in what order the veto sees them. It never
 * decides who receives anything — that is the veto's job, and keeping the two separate
 * is what stops "the axis matched" from silently becoming "so we sent it".
 *
 * Pure, and every ordering is total, so an Inngest step replay produces the same list.
 */

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
  /** contactId -> days since their last message. Absent means never messaged. */
  daysSinceLastMessage: Map<string, number>;
  minDaysBetweenMessages: number;
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
 * Six filters in order, then selection. Every drop carries a reason: a candidate count
 * that shrinks with nothing recorded is the silent-filtering failure this codebase has
 * now hit three times.
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
    // 2. Pace. A radar with no ask has no right to be frequent.
    const days = input.daysSinceLastMessage.get(c.contactId);
    if (days != null && days < input.minDaysBetweenMessages) {
      dropped.push({ candidate: c, reason: "too_soon" });
      continue;
    }
    // 3. Diversity as a hard rule, not only a penalty: three of the same kind in a row
    //    makes a person a topic feed rather than someone you thought of.
    const recent = input.recentKinds.get(c.contactId) ?? [];
    if (recent.length >= 3 && recent.slice(0, 3).every((k) => k === c.kind)) {
      dropped.push({ candidate: c, reason: "kind_fatigue" });
      continue;
    }
    survivors.push(c);
  }

  // 4. One candidate per person per run. The veto is expensive and a person can receive
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
