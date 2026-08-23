import { describe, it, expect } from "vitest";
import { rankForPeople, diversityPenalty, pairKey, type RankCandidate } from "@/lib/tech-radar/person-rank";

function cand(over: Partial<RankCandidate> = {}): RankCandidate {
  return {
    contactId: "c1",
    itemId: "i1",
    axisId: "ax1",
    trackedCompanyId: "tc1",
    axisScore: 0.8,
    personWeight: 1,
    kind: "research",
    ...over,
  };
}
function input(over: Partial<Parameters<typeof rankForPeople>[0]> = {}) {
  return {
    candidates: [] as RankCandidate[],
    alreadySeen: new Set<string>(),
    recentKinds: new Map<string, string[]>(),
    daysSinceLastMessage: new Map<string, number>(),
    minDaysBetweenMessages: 7,
    limit: 10,
    ...over,
  };
}

describe("diversityPenalty", () => {
  it("is zero for someone with no history", () => {
    expect(diversityPenalty("research", undefined)).toBe(0);
    expect(diversityPenalty("research", [])).toBe(0);
  });

  it("grows with each recent draft of the same kind", () => {
    expect(diversityPenalty("research", ["research"])).toBeCloseTo(0.15);
    expect(diversityPenalty("research", ["research", "research"])).toBeCloseTo(0.3);
  });

  it("ignores history beyond the last three", () => {
    expect(diversityPenalty("research", ["research", "research", "research", "research"])).toBeCloseTo(0.45);
  });

  it("does not penalise a different kind", () => {
    expect(diversityPenalty("trend", ["research", "research"])).toBe(0);
  });
});

describe("rankForPeople", () => {
  /** Every filter records a reason. A count that shrinks silently is the bug we keep hitting. */
  it("records a reason for every drop", () => {
    const out = rankForPeople(
      input({
        candidates: [cand({ contactId: "seen" }), cand({ contactId: "soon" }), cand({ contactId: "ok" })],
        alreadySeen: new Set([pairKey("seen", "i1")]),
        daysSinceLastMessage: new Map([["soon", 2]]),
      })
    );
    expect(out.ranked.map((c) => c.contactId)).toEqual(["ok"]);
    expect(out.dropped.map((d) => d.reason).sort()).toEqual(["already_seen", "too_soon"]);
  });

  it("lets through someone who has never been messaged", () => {
    const out = rankForPeople(input({ candidates: [cand()] }));
    expect(out.ranked).toHaveLength(1);
  });

  it("lets through someone whose pace window has passed", () => {
    const out = rankForPeople(input({ candidates: [cand()], daysSinceLastMessage: new Map([["c1", 7]]) }));
    expect(out.ranked).toHaveLength(1);
  });

  /** Three of one kind in a row makes a person a topic feed, not someone you thought of. */
  it("blocks a fourth consecutive item of the same kind outright", () => {
    const out = rankForPeople(
      input({ candidates: [cand()], recentKinds: new Map([["c1", ["research", "research", "research"]]]) })
    );
    expect(out.ranked).toHaveLength(0);
    expect(out.dropped[0].reason).toBe("kind_fatigue");
  });

  it("allows a different kind after three of one", () => {
    const out = rankForPeople(
      input({ candidates: [cand({ kind: "trend" })], recentKinds: new Map([["c1", ["research", "research", "research"]]]) })
    );
    expect(out.ranked).toHaveLength(1);
  });

  /**
   * One candidate per person per run: the veto is the expensive call, and a person can
   * receive at most one thing, so a second candidate is a wasted call and a second draft.
   */
  it("keeps only the best candidate for each person", () => {
    const out = rankForPeople(
      input({
        candidates: [
          cand({ itemId: "i-low", axisScore: 0.5 }),
          cand({ itemId: "i-high", axisScore: 0.95 }),
        ],
      })
    );
    expect(out.ranked).toHaveLength(1);
    expect(out.ranked[0].itemId).toBe("i-high");
    expect(out.dropped.map((d) => d.reason)).toEqual(["outranked_for_person"]);
  });

  it("weighs the person's own axis weight, not only the shared score", () => {
    const out = rankForPeople(
      input({
        candidates: [
          cand({ itemId: "i-strong-axis", axisScore: 0.9, personWeight: 0.3 }),
          cand({ itemId: "i-their-thing", axisScore: 0.6, personWeight: 1.5 }),
        ],
      })
    );
    expect(out.ranked[0].itemId).toBe("i-their-thing");
  });

  it("lets the diversity penalty change the order", () => {
    const out = rankForPeople(
      input({
        candidates: [
          cand({ contactId: "a", itemId: "i1", axisScore: 0.8, kind: "research" }),
          cand({ contactId: "b", itemId: "i2", axisScore: 0.75, kind: "trend" }),
        ],
        recentKinds: new Map([["a", ["research", "research"]]]),
      })
    );
    // a: 0.8 - 0.3 = 0.5; b: 0.75 - 0 = 0.75
    expect(out.ranked.map((c) => c.contactId)).toEqual(["b", "a"]);
  });

  it("caps the run and records what it cut", () => {
    const out = rankForPeople(
      input({
        candidates: [
          cand({ contactId: "a", axisScore: 0.9 }),
          cand({ contactId: "b", axisScore: 0.8 }),
          cand({ contactId: "c", axisScore: 0.7 }),
        ],
        limit: 2,
      })
    );
    expect(out.ranked.map((c) => c.contactId)).toEqual(["a", "b"]);
    expect(out.dropped).toEqual([{ candidate: expect.objectContaining({ contactId: "c" }), reason: "over_run_limit" }]);
  });

  it("returns nothing at a limit of zero, rather than everything", () => {
    expect(rankForPeople(input({ candidates: [cand()], limit: 0 })).ranked).toEqual([]);
  });

  /** Determinism: an Inngest step replay must produce the identical list. */
  it("is stable when scores tie", () => {
    const candidates = [
      cand({ contactId: "b", itemId: "i2" }),
      cand({ contactId: "a", itemId: "i1" }),
      cand({ contactId: "c", itemId: "i1" }),
    ];
    const first = rankForPeople(input({ candidates })).ranked.map((c) => c.contactId);
    const again = rankForPeople(input({ candidates: [...candidates].reverse() })).ranked.map((c) => c.contactId);
    expect(first).toEqual(again);
  });
});
