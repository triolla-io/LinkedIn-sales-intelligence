import { describe, it, expect } from "vitest";

import {
  opensWithTitle,
  unknownNames,
  disclaimedSubjects,
  contradictsReasoning,
  competitorGazetteer,
  declaresPersonSide,
  declaresCompanySide,
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

/**
 * The 2026-08-26 run produced UNIONS, not intersections: Erez Rachmil (CITO, Bank
 * Hapoalim) got core-systems modernization, real-time payments, open APIs and fraud
 * detection — four axes that fit any CITO at any bank, i.e. his EMPLOYER'S axes. The
 * crossing never happened, and no rule could tell, because the two sides of it existed
 * only as prose inside one Hebrew sentence.
 *
 * So each axis now DECLARES its two sides, and these rules check the declaration:
 * personDecision must point at ownership, companyFact must name a competitor the
 * research actually found or a customer segment.
 */
describe("declaresPersonSide", () => {
  it("accepts a decision the person signs", () => {
    expect(declaresPersonSide("חתום על ארכיטקטורת הליבה ועל תקציב הסייבר")).toBe(true);
    expect(declaresPersonSide("מחזיקה את החלטת ההיצע הקמעונאי")).toBe(true);
  });

  it("rejects the bare job title, the same failure the rationale rule catches one field over", () => {
    expect(declaresPersonSide("כראש בנקאות קמעונאית")).toBe(false);
    expect(declaresPersonSide("כ-CITO של בנק הפועלים")).toBe(false);
  });

  it("rejects a title with no ownership word in it at all", () => {
    // "ראש בנקאות קמעונאית" names the chair, not what the chair signs — which is
    // exactly the union the swap test exists to break.
    expect(declaresPersonSide("ראש בנקאות קמעונאית")).toBe(false);
  });

  it("rejects an empty declaration — a missing side admits no crossing happened", () => {
    expect(declaresPersonSide("")).toBe(false);
    expect(declaresPersonSide("   ")).toBe(false);
  });

  it("reads an ownership word through a Hebrew prefix and a final letter form", () => {
    // "חתום" ends in a final mem, so a stem written "חתומ" would never match it, and
    // "בהחלטות" carries the ownership noun behind a ב prefix.
    expect(declaresPersonSide("חתום על מערכות הליבה")).toBe(true);
    expect(declaresPersonSide("שותף בהחלטות התמחור של האשראי הצרכני")).toBe(true);
  });
});

describe("declaresCompanySide", () => {
  const gazetteer = competitorGazetteer([
    "Bank Leumi / בנק לאומי / לאומי",
    "Pepper",
  ]);

  it("accepts a competitor the employer research actually found, in either script", () => {
    expect(declaresCompanySide("לאומי משיק אשראי צרכני מיידי", gazetteer)).toBe(true);
    expect(declaresCompanySide("Pepper is taking the young retail segment", gazetteer)).toBe(true);
  });

  it("accepts a Hebrew customer segment, because the researched segments are stored in English", () => {
    expect(declaresCompanySide("הלקוחות הם צרכנים פרטיים שנוטלים הלוואות וחוסכים", gazetteer)).toBe(true);
    expect(declaresCompanySide("מבוטחי הביטוח הסיעודי", gazetteer)).toBe(true);
  });

  it("accepts a verbatim quote of the employer's own English segment when it is supplied", () => {
    expect(
      declaresCompanySide("B2C: Individual consumers", gazetteer, [
        "B2C: Individual consumers and retail customers",
      ])
    ).toBe(true);
  });

  it("rejects a fact that names neither a competitor nor a segment", () => {
    expect(declaresCompanySide("בנק גדול בישראל", gazetteer)).toBe(false);
    expect(declaresCompanySide("", gazetteer)).toBe(false);
  });

  it("does not accept a technical acronym as the company side", () => {
    // The ACRONYM exemption in unknownNames exists because API/CTO/KYC are not company
    // names. The same must hold here, in the other direction: naming a technology is
    // not naming a fact about the company.
    expect(declaresCompanySide("ארכיטקטורת API פתוחה ותקני KYC", gazetteer)).toBe(false);
  });

  it("rejects a rival name the research never found, rather than trusting the declaration", () => {
    expect(declaresCompanySide("Revolut נכנסת לשוק הישראלי", gazetteer)).toBe(false);
  });
});
