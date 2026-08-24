import { describe, it, expect } from "vitest";
import { deriveQuietReason } from "@/lib/tech-radar/quiet";

/** Priority order is the contract: waiting → all_vetoed → no_material. A quiet day must
 *  read as a decision, and the decision has to be the RIGHT one — a person in cooldown
 *  with vetoed candidates is waiting, not rejected. */

const NOW = new Date("2026-08-24T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5);

describe("deriveQuietReason", () => {
  it("a recent message wins over everything", () => {
    expect(deriveQuietReason({ lastMessageAt: daysAgo(5), vetoedThisWeek: 3, now: NOW }))
      .toEqual({ kind: "waiting", daysSinceMessage: 5 });
  });

  it("an old message does not count as waiting", () => {
    expect(deriveQuietReason({ lastMessageAt: daysAgo(21), vetoedThisWeek: 0, now: NOW }))
      .toEqual({ kind: "no_material" });
  });

  it("vetoed candidates explain the quiet when there is no cooldown", () => {
    expect(deriveQuietReason({ lastMessageAt: null, vetoedThisWeek: 4, now: NOW }))
      .toEqual({ kind: "all_vetoed", count: 4 });
  });

  it("no signal at all means no material", () => {
    expect(deriveQuietReason({ lastMessageAt: null, vetoedThisWeek: 0, now: NOW }))
      .toEqual({ kind: "no_material" });
  });
});
