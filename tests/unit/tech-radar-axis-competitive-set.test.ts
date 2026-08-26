import { describe, it, expect } from "vitest";
import {
  sharesCompetitiveSet,
  judgeCompetitiveSetMerge,
  MIN_SHARED_COMPETITORS,
  type CompetitiveSet,
} from "@/lib/tech-radar/axis";

/**
 * The 2026-08-26 incident, as data.
 *
 * Gil Tamir (Phoenix, insurance) was processed first and created "תחרות דיגיטלית מול
 * הראל ומגדל". Elinor Levinson Gafni (Bank Leumi) proposed her own competitive axis —
 * naming הפועלים, דיסקונט ומזרחי-טפחות, all correct — and the label-similarity merge
 * folded her into Gil's axis. She then spent one of her two axes searching
 * "ביטוח הראל אפליקציה דיגיטלית חדשה", because the RadarAxis row owns the queries.
 *
 * These are the researched competitor lists in the shape research actually writes them:
 * every name in both scripts, separated by " / ".
 */
const leumi: CompetitiveSet = {
  employerId: "tc-leumi",
  names: ["Bank Leumi", "בנק לאומי", "לאומי"],
  namedCompetitors: [
    "Bank Hapoalim / בנק הפועלים / הפועלים",
    "Israel Discount Bank / בנק דיסקונט / דיסקונט",
    "Mizrahi-Tefahot / מזרחי טפחות / מזרחי",
    "First International Bank / הבנק הבינלאומי",
    "One Zero / וואן זירו",
  ],
};

const hapoalim: CompetitiveSet = {
  employerId: "tc-hapoalim",
  names: ["Bank Hapoalim", "בנק הפועלים", "הפועלים"],
  namedCompetitors: [
    "Bank Leumi / בנק לאומי / לאומי",
    "Israel Discount Bank / בנק דיסקונט / דיסקונט",
    "Mizrahi-Tefahot / מזרחי טפחות / מזרחי",
    "One Zero / וואן זירו",
  ],
};

const phoenix: CompetitiveSet = {
  employerId: "tc-phoenix",
  names: ["The Phoenix Holdings", "הפניקס"],
  namedCompetitors: [
    "Harel Insurance / הראל",
    "Migdal Insurance / מגדל",
    "Menora Mivtachim / מנורה מבטחים",
    "Clal Insurance / כלל ביטוח",
    "Lemonade",
    // Banks compete with insurers on pension and savings, so a bank really does belong
    // on an insurer's list. It is the reason ONE shared name cannot be the test.
    "Bank Hapoalim / בנק הפועלים / הפועלים",
  ],
};

const harel: CompetitiveSet = {
  employerId: "tc-harel",
  names: ["Harel Insurance", "הראל"],
  namedCompetitors: [
    "The Phoenix Holdings / הפניקס",
    "Migdal Insurance / מגדל",
    "Menora Mivtachim / מנורה מבטחים",
    "Clal Insurance / כלל ביטוח",
  ],
};

describe("sharesCompetitiveSet", () => {
  it("is always true for two people at the SAME employer", () => {
    const noResearch = { ...hapoalim, employerId: "tc-hapoalim", namedCompetitors: [] };
    expect(sharesCompetitiveSet(hapoalim, noResearch)).toBe(true);
  });

  /** Two big Israeli banks: they name each other, and share דיסקונט, מזרחי and וואן זירו. */
  it("holds between two banks", () => {
    expect(sharesCompetitiveSet(leumi, hapoalim)).toBe(true);
    expect(sharesCompetitiveSet(hapoalim, leumi)).toBe(true);
  });

  /** Two insurers, likewise: mutual naming plus מגדל, מנורה, כלל. */
  it("holds between two insurers", () => {
    expect(sharesCompetitiveSet(phoenix, harel)).toBe(true);
  });

  /** THE incident. Phoenix ∩ Leumi = {בנק הפועלים}. One name is not a shared set. */
  it("does NOT hold between an insurer and a bank", () => {
    expect(sharesCompetitiveSet(phoenix, leumi)).toBe(false);
    expect(sharesCompetitiveSet(leumi, phoenix)).toBe(false);
  });

  /** Phoenix names Hapoalim; Hapoalim's list is other banks. Naming must be MUTUAL. */
  it("does not accept one-directional naming as a shared set", () => {
    expect(sharesCompetitiveSet(phoenix, hapoalim)).toBe(false);
    expect(sharesCompetitiveSet(hapoalim, phoenix)).toBe(false);
  });

  /**
   * The alias spellings of ONE competitor must count once. Research writes
   * "Israel Discount Bank / בנק דיסקונט / דיסקונט" — three strings, one company — and
   * counting them separately would clear a threshold of two on a single shared rival.
   */
  it("counts one competitor written three ways as one shared competitor", () => {
    const a: CompetitiveSet = {
      employerId: "tc-a",
      names: ["Alpha"],
      namedCompetitors: ["Israel Discount Bank / בנק דיסקונט / דיסקונט"],
    };
    const b: CompetitiveSet = {
      employerId: "tc-b",
      names: ["Beta"],
      namedCompetitors: ["Israel Discount Bank / בנק דיסקונט / דיסקונט"],
    };
    expect(sharesCompetitiveSet(a, b)).toBe(false);
  });

  it("matches a competitor across scripts and short forms", () => {
    const a: CompetitiveSet = {
      employerId: "tc-a",
      names: ["Alpha"],
      namedCompetitors: ["Bank Leumi / בנק לאומי / לאומי", "Mizrahi-Tefahot / מזרחי טפחות"],
    };
    // Same two rivals, each written in the other script only.
    const b: CompetitiveSet = {
      employerId: "tc-b",
      names: ["Beta"],
      namedCompetitors: ["לאומי", "Mizrahi-Tefahot"],
    };
    expect(sharesCompetitiveSet(a, b)).toBe(true);
  });

  /** "בנק" / "bank" is a category, not a name; it must never bridge two banks. */
  it("does not match two different banks on the shared word בנק", () => {
    const a: CompetitiveSet = { employerId: "tc-a", names: ["Alpha"], namedCompetitors: ["בנק דיסקונט", "בנק אגוד"] };
    const b: CompetitiveSet = { employerId: "tc-b", names: ["Beta"], namedCompetitors: ["בנק לאומי", "בנק מסד"] };
    expect(sharesCompetitiveSet(a, b)).toBe(false);
  });

  /** noClearCompetitors is an active research finding: it shares a set with nobody. */
  it("is false when either side has no researched competitors", () => {
    const monopoly: CompetitiveSet = { employerId: "tc-mono", names: ["Mekorot"], namedCompetitors: [] };
    expect(sharesCompetitiveSet(monopoly, leumi)).toBe(false);
    expect(sharesCompetitiveSet(leumi, monopoly)).toBe(false);
  });

  it("needs more than one shared name, by construction", () => {
    expect(MIN_SHARED_COMPETITORS).toBeGreaterThan(1);
  });
});

describe("judgeCompetitiveSetMerge", () => {
  it("allows a merge when every subscriber's employer shares the set", () => {
    expect(judgeCompetitiveSetMerge(leumi, [hapoalim, hapoalim])).toEqual({ allowed: true });
  });

  /** Elinor into Gil's axis — the merge that put insurance queries on a bank VP. */
  it("refuses the merge that produced the incident, naming the employer that blocked it", () => {
    const verdict = judgeCompetitiveSetMerge(leumi, [phoenix]);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toBe("no_shared_competitive_set");
      // The employer's canonical TrackedCompany name, so the rebuild report says WHO
      // blocked it rather than printing an id.
      expect(verdict.blockedBy).toBe("The Phoenix Holdings");
    }
  });

  /**
   * ALL subscribers, not any: "any" would let a bank join an insurer's axis through a
   * third subscriber, and the axis would end up describing nobody's competitive set.
   */
  it("refuses when even one of several subscribers does not share the set", () => {
    expect(judgeCompetitiveSetMerge(leumi, [hapoalim, phoenix]).allowed).toBe(false);
  });

  /**
   * An axis nobody subscribes to carries nobody's competitive set into anyone's model,
   * and refusing it would mint a duplicate on every forced rebuild — walking the org
   * toward the 60-axis ceiling that already cost three people their agenda axis.
   */
  it("allows a merge into an axis with no subscribers left", () => {
    expect(judgeCompetitiveSetMerge(leumi, [])).toEqual({ allowed: true });
  });
});
