import { describe, it, expect } from "vitest";

import {
  opensWithTitle,
  unknownNames,
  disclaimedSubjects,
  contradictsReasoning,
  competitorGazetteer,
} from "@/lib/tech-radar/rationale-rules";

/**
 * Deterministic rules, enforced in production. The LLM judge (lib/tech-radar/rationale-
 * gate.ts) proved unreliable at exactly this on 2026-08-26: within ONE batch at
 * temperature 0 it killed one "כ-CITO…" rationale and passed three identical ones. So
 * the rule is code, the prompt is the first line of defence, and the judge is a third
 * net — not the enforcement.
 */
describe("opensWithTitle", () => {
  it("rejects the exact pattern that slipped through the judge", () => {
    expect(opensWithTitle("כ-CITO של בנק גדול, רחמיל חתום על כל החלטות בטיחות סייבר")).toBe(true);
  });

  it("rejects the Hebrew-prefixed form with no hyphen", () => {
    expect(opensWithTitle("כראש בנקאות קמעונאית, פזית חתומה על המוצרים")).toBe(true);
  });

  it("rejects it after leading whitespace", () => {
    expect(opensWithTitle("  כ-VP Product היא אחראית על האפליקציה")).toBe(true);
  });

  it("accepts a rationale that points at a decision", () => {
    expect(opensWithTitle("כי הוא מחזיק את החלטת המודרניזציה שהבנק מכריז עליה כעת")).toBe(false);
  });

  it("does not fire on 'כי' or 'כאשר', which open legitimate sentences", () => {
    expect(opensWithTitle("כי לאומי מתחרה על אותם לקוחות")).toBe(false);
    expect(opensWithTitle("כאשר לאומי השיקה את השירות, הלקוחות שלה נחשפו")).toBe(false);
    expect(opensWithTitle("כמו שקרה כשלאומי השיקה")).toBe(false);
  });
});

/**
 * "ראשון לציון" appeared as a competitor in Pazit Garfinkel's rationale. It is a city.
 * An invented name in a message to a board member is not a recoverable mistake, so a
 * name that is not in the employer research is not allowed to reach a draft.
 */
describe("competitorGazetteer", () => {
  it("accepts both scripts of the same competitor as one entry", () => {
    const g = competitorGazetteer(["Bank Leumi / בנק לאומי / לאומי", "Lemonade"]);
    expect(g).toContain("bank leumi");
    expect(g).toContain("בנק לאומי");
    expect(g).toContain("לאומי");
    expect(g).toContain("lemonade");
  });
});

describe("unknownNames", () => {
  const allowed = competitorGazetteer([
    "Bank Leumi / בנק לאומי / לאומי",
    "Israel Discount Bank / בנק דיסקונט / דיסקונט",
    "Pepper",
    "Lemonade",
  ]);

  it("flags the hallucinated city in an enumeration of rivals", () => {
    const found = unknownNames("כי היא אחראית על שמירת נתח שוק מפני לאומי, דיסקונט, וראשון לציון", allowed);
    expect(found).toEqual(["ראשון לציון"]);
  });

  it("accepts the short Hebrew form of a competitor listed in English", () => {
    expect(unknownNames("כי לאומי ודיסקונט מתחרים על הלקוחות שלה", allowed)).toEqual([]);
  });

  it("accepts a Latin-script competitor from the list", () => {
    expect(unknownNames("כי Pepper ו-Lemonade תוקפים את הלקוחות שלו", allowed)).toEqual([]);
  });

  it("flags a Latin-script name that is not in the research", () => {
    expect(unknownNames("כי Revolut נכנסת לשוק שלה", allowed)).toEqual(["Revolut"]);
  });

  it("ignores prose with no rival enumeration at all", () => {
    expect(unknownNames("כי הוא מחזיק את החלטת המודרניזציה של מערכות הליבה", allowed)).toEqual([]);
  });

  /**
   * The 2026-08-26 preview: this rule deleted three of Erez Rachmil's five axes on
   * "unknown_competitor: API, CTO, AI" and two of Elinor's on "KYC, API". An all-caps
   * acronym is a technical term, not a company — it cannot BE the failure this rule
   * exists to catch, which is an invented company name reaching an executive. The CITO,
   * whose whole world is written in acronyms, is the person it silenced hardest.
   */
  it("does not mistake a technical acronym for a company name", () => {
    const r = "כי הוא חתום על המעבר לארכיטקטורת API-first ועל מינוי ה-CTO החדש, ועל זיהוי הונאות מבוסס AI ואוטומציה של KYC";
    expect(unknownNames(r, allowed)).toEqual([]);
  });

  it("still flags a Title-Case name sitting next to acronyms", () => {
    // The acronym exemption must not become a hole: a real invented name in the same
    // sentence has to survive it.
    expect(unknownNames("כי Revolut בונה API פתוח מול ה-CTO שלה", allowed)).toEqual(["Revolut"]);
  });
});

/**
 * Pazit's reasoning said "היא לא חתומה על מודרניזציית מערכות ליבה (זה של ה-CTO החדש)"
 * and the brain then proposed a core-modernization axis in the same response. The
 * contradiction is inside one call, so it is free to catch.
 */
describe("disclaimedSubjects", () => {
  it("extracts what the reasoning explicitly says is NOT this person's", () => {
    const out = disclaimedSubjects(
      "(א) כראש בנקאות קמעונאית היא חתומה על המוצרים. היא לא חתומה על מודרניזציית מערכות ליבה (זה של ה-CTO החדש) או על אסטרטגיית ההשקעות."
    );
    expect(out.join(" ")).toContain("מערכות ליבה");
  });

  it("handles the masculine form", () => {
    const out = disclaimedSubjects("הוא לא חותם על מוצרים פיננסיים, אלא על התשתית");
    expect(out.join(" ")).toContain("מוצרים פיננסיים");
  });

  it("returns nothing when the reasoning disclaims nothing", () => {
    expect(disclaimedSubjects("(א) הוא חותם על ארכיטקטורת הליבה ועל אבטחת המידע")).toEqual([]);
  });
});

describe("contradictsReasoning", () => {
  const reasoning =
    "היא לא חתומה על מודרניזציית מערכות ליבה (זה של ה-CTO החדש) או על אסטרטגיית ההשקעות.";

  it("rejects an axis built on a subject the reasoning disclaimed", () => {
    expect(
      contradictsReasoning(
        { label: "מודרניזציית הטכנולוגיה והשפעתה על חווית הלקוח", rationale: "כי הפועלים משקיעה במערכות ליבה חדשות" },
        reasoning
      )
    ).toBe(true);
  });

  it("keeps an axis on a subject the reasoning did not disclaim", () => {
    expect(
      contradictsReasoning(
        { label: "התקפות מתחרים על בנקאות קמעונאית", rationale: "כי לאומי מתחרה על הלקוחות שלה" },
        reasoning
      )
    ).toBe(false);
  });
});
