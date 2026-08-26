import { describe, it, expect } from "vitest";

import { supersededMatches, supersededDrafts } from "@/lib/tech-radar/superseded";

/**
 * A rebuild replaces a person's axes. Everything already computed against the axes it
 * removed was computed through the old lens — Erez Rachmil's 11 vetoes were all judged
 * against CTO-lens axes — and must stop presenting itself as the current decision.
 *
 * Marked, never deleted: the trail is how a wrong decision can be argued with later.
 * And never the SENT draft — that one actually went to a human being.
 */
describe("supersededMatches", () => {
  it("marks a match whose axis nobody subscribes to any more", () => {
    const out = supersededMatches(
      [{ id: "m1", axisId: "dead" }, { id: "m2", axisId: "live" }],
      new Set(["live"])
    );
    expect(out).toEqual(["m1"]);
  });

  it("keeps a match whose axis still has ONE subscriber", () => {
    // AxisMatch is judged once and shared by every subscriber — that sharing is the cost
    // lever. One remaining subscriber anywhere in the org keeps the judgement alive.
    expect(supersededMatches([{ id: "m1", axisId: "shared" }], new Set(["shared"]))).toEqual([]);
  });

  it("marks nothing when every axis survived", () => {
    expect(supersededMatches([{ id: "m1", axisId: "a" }], new Set(["a", "b"]))).toEqual([]);
  });
});

describe("supersededDrafts", () => {
  const live = new Map([["erez", new Set(["newA", "newB"])]]);

  it("marks a veto judged against an axis the rebuild removed", () => {
    const out = supersededDrafts(
      [{ id: "d1", contactId: "erez", axisId: "oldCto", status: "VETOED" }],
      live
    );
    expect(out).toEqual(["d1"]);
  });

  it("never marks a SENT draft — that is real history", () => {
    const out = supersededDrafts(
      [{ id: "d1", contactId: "pazit", axisId: "oldAxis", status: "SENT" }],
      new Map([["pazit", new Set(["brandNew"])]])
    );
    expect(out).toEqual([]);
  });

  it("marks a pending draft on a dead axis — it must not stay approvable", () => {
    const out = supersededDrafts(
      [{ id: "d1", contactId: "erez", axisId: "oldCto", status: "PENDING_REVIEW" }],
      live
    );
    expect(out).toEqual(["d1"]);
  });

  it("keeps a draft whose axis survived the rebuild", () => {
    const out = supersededDrafts(
      [{ id: "d1", contactId: "erez", axisId: "newA", status: "VETOED" }],
      live
    );
    expect(out).toEqual([]);
  });

  it("marks a draft with no axis at all when the person was rebuilt", () => {
    // axisId is nullable "only for a vetoed candidate" — those were judged under the old
    // model too, and a null axis can never be shown to have survived.
    const out = supersededDrafts(
      [{ id: "d1", contactId: "erez", axisId: null, status: "VETOED" }],
      live
    );
    expect(out).toEqual(["d1"]);
  });

  it("leaves a person the rebuild did not touch completely alone", () => {
    // No entry in the live map means nothing was rebuilt for them; marking their drafts
    // would rewrite history for someone whose model never changed.
    const out = supersededDrafts(
      [{ id: "d1", contactId: "untouched", axisId: "whatever", status: "VETOED" }],
      live
    );
    expect(out).toEqual([]);
  });
});
