import { describe, expect, it } from "vitest";
import {
  checkDraft,
  MAX_DRAFT_CHARS,
  SOFT_DRAFT_CHARS,
  whyHimCopied,
  hebrewAgreementErrors,
} from "@/lib/tech-radar/draft-guard";

describe("rhetorical opener", () => {
  it("allows a question mark in the opening sentence — Yuval's voice", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש על הונאות. זה נוגע ישר בביט.\nhttps://a.com/x")).toEqual([]);
  });
  it("still flags a question after the opener as an ask", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש. מה דעתך שנדבר?")).toContain("ask");
  });
  it("still flags a trailing question with no opener question", () => {
    expect(checkDraft("היי דנה, נתקלתי במחקר.\nשווה שנקבע שיחה?")).toContain("ask");
  });
  it("does not treat a URL query string as an ask", () => {
    expect(checkDraft("היי דנה, מחקר מעניין!\nhttps://a.com/x?utm=1&y=2")).toEqual([]);
  });
  it("does not treat a decimal point in a funding figure as a sentence end", () => {
    // The opener itself carries the figure; content follows so this is not the
    // bare single-question shape (see the "single-sentence ask" tests below) —
    // it isolates the decimal-boundary behaviour from the lone-question rule.
    expect(checkDraft("היי דנה, ראית שגייסו 3.5 מיליון דולר?\nמחקר מעניין.")).toEqual([]);
  });
  it("still flags a run-on with no space after the period hiding a later ask", () => {
    expect(checkDraft("היי דנה, ראית את המחקר.יש לך זמן לשיחה?")).toContain("ask");
  });
  it("flags a single-sentence meeting ask with no boundary before its '?'", () => {
    expect(checkDraft("היי דנה, יש לך זמן השבוע?")).toContain("ask");
  });
  it("flags a single-sentence 'let's meet' ask with no boundary before its '?'", () => {
    expect(checkDraft("היי דנה, נוכל להיפגש בשבוע הבא כדי לעבור על זה?")).toContain("ask");
  });
  it("flags a single-sentence ask even when a comma precedes it (a comma is not a boundary)", () => {
    expect(checkDraft("היי דנה, ראיתי מחקר מעניין, נוכל לדבר עליו?")).toContain("ask");
  });
  it("still flags a real trailing ask after a legitimate opener", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש. יש לך זמן?")).toContain("ask");
  });
  it("still returns [] for the legitimate opener-plus-content shape with no later ask", () => {
    expect(checkDraft("היי דנה, ראית את זה?\nמחקר חדש על הונאות. זה נוגע ישר בביט.")).toEqual([]);
  });
});

describe("meeting-ask phrases, caught by wording — not by position", () => {
  /**
   * The positional rule only fires when the tail after the opener's "?" is empty. Once
   * the model writes the 3-6 sentence body the prompt requires, the tail is never empty
   * again, so a meeting ask phrased in the opening sentence must be caught by wording.
   * "No meeting request, ever" is a hard rule, so it cannot depend on the message
   * happening to stop right after the question.
   */
  it("flags 'יש לך זמן' in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, יש לך זמן השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags the 'יש לכם זמן' inflection in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, יש לכם זמן השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags 'נוכל להיפגש' in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, נוכל להיפגש השבוע? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
  it("flags the 'נוכל לדבר' inflection in the opening sentence of a message with a body", () => {
    expect(checkDraft("היי דנה, נוכל לדבר על זה? מחקר חדש על הונאות מראה דברים מעניינים.")).toContain("ask");
  });
});

/**
 * 600 was a hard block until 2026-08-26, when it turned out that an opener plus the
 * 2-3 sentence content paragraph plus a "why him" line lands right around it — so the
 * hard cap was rejecting good drafts over two characters, in the one run whose purpose
 * was volume. 600 now ADVISES ("long") and 900 blocks ("too_long").
 */
describe("length tiers", () => {
  it("advises at 600 and blocks at 900", () => {
    expect(SOFT_DRAFT_CHARS).toBe(600);
    expect(MAX_DRAFT_CHARS).toBe(900);
  });
  it("advises, and does not block, a 700-char message", () => {
    const v = checkDraft("מ".repeat(700) + "\nhttps://a.com/x");
    expect(v).toContain("long");
    expect(v).not.toContain("too_long");
  });
  it("flags a message over 900 chars (excluding the URL)", () => {
    const long = "מ".repeat(901) + "\nhttps://a.com/x";
    expect(checkDraft(long)).toContain("too_long");
  });
  it("does not count the URL toward the cap", () => {
    const ok = "מ".repeat(590) + "\nhttps://a.com/" + "x".repeat(200);
    expect(checkDraft(ok)).not.toContain("too_long");
  });
  it("does not flag exactly 600 chars — the boundary is inclusive", () => {
    const exact = "מ".repeat(600) + "\nhttps://a.com/x";
    expect(checkDraft(exact)).not.toContain("too_long");
  });
});

describe("unchanged hard rules", () => {
  it("still flags meeting asks, adoption suggestions, self-pitch, emoji", () => {
    expect(checkDraft("בוא נקבע שיחה קצרה")).toContain("ask");
    expect(checkDraft("כדאי לבדוק את הכלי")).toContain("adoption_suggestion");
    expect(checkDraft("החברה שלנו עושה בדיוק את זה")).toContain("self_pitch");
    expect(checkDraft("מחקר מטורף 🚀")).toContain("emoji");
  });
});

/**
 * The real 2026-08-26 draft to Gil Tamir opened "נתקלתי במחקר על משהו שכנראה קשור
 * ישירות לבחירות שלך" — a placeholder noun ("משהו") plus a hedge ("שכנראה") that
 * together name nothing. The opener must name the subject.
 */
describe("opener_mush", () => {
  it("flags the shipped opener — placeholder noun plus hedge, names nothing", () => {
    expect(
      checkDraft(
        "גיל, נתקלתי במחקר על משהו שכנראה קשור ישירות לבחירות שלך.\nחברות ביטוח משתמשות בנתונים לא מסורתיים."
      )
    ).toContain("opener_mush");
  });

  it("does not flag an opener that names the subject", () => {
    expect(
      checkDraft("גיל, ראיתי שרגולטורים בבריטניה מחמירים על תמחור אלגוריתמי.\nזה נוגע ישר בתמחור שלכם.")
    ).not.toContain("opener_mush");
  });

  it("flags a placeholder noun with no concrete noun at all, even without a hedge", () => {
    // No Latin token, no quoted phrase, and no word over 3 Hebrew letters outside the
    // hedge/placeholder/function-word lists — "יש" and "כאן" are both too short to count.
    expect(checkDraft("גיל, יש כאן משהו.\nחברות ביטוח משתמשות בנתונים.")).toContain("opener_mush");
  });

  it("does not flag a hedge with no placeholder noun", () => {
    expect(checkDraft("גיל, כנראה שרגולטורים מחמירים על תמחור אלגוריתמי.")).not.toContain("opener_mush");
  });

  /**
   * Fix round 1: the placeholder/hedge lists were plain substring matches — JS regex
   * has no Hebrew-aware `\b` — so they fired inside unrelated longer words. A fully
   * concrete opener with none of these words at all must never be flagged.
   */
  it("does not flag 'נושא' sitting inside 'הנושא'/'נושאים', not standing alone", () => {
    expect(
      checkDraft("גיל, ראיתי שהנושא של תמחור אלגוריתמי בבריטניה אולי מגיע גם לישראל.\nזה נוגע ישר בכם.")
    ).not.toContain("opener_mush");
  });

  it("does not flag 'עניין' sitting inside 'בעניין'", () => {
    expect(
      checkDraft("גיל, ראיתי כתבה בעניין הרגולציה החדשה בבריטניה על תמחור אלגוריתמי.\nזה נוגע ישר בכם.")
    ).not.toContain("opener_mush");
  });

  it("does not flag 'בטח' sitting inside 'בטחונות' (a live fintech word)", () => {
    expect(
      checkDraft("גיל, ראיתי שדרישות הבטחונות בבנקים באירופה מחמירות.\nזה נוגע ישר בכם.")
    ).not.toContain("opener_mush");
  });

  it("still flags a standalone 'נושא' used as a placeholder", () => {
    expect(checkDraft("גיל, יש נושא שכנראה קשור אליכם.\nתוכן.")).toContain("opener_mush");
  });

  /**
   * HEDGE_GLUED_FORWARD ("יכול להיות ש") never got the leading-boundary exception for a
   * glued relative "ש-" that HEDGE_STANDALONE already has. "שיכול להיות ש" (ש + יכול...)
   * was silently NOT recognized as a hedge, so this genuine mush opener slipped through.
   */
  it("flags a placeholder noun plus 'יכול להיות ש' hedge glued behind a relative ש-", () => {
    expect(checkDraft("גיל, יש כאן משהו שיכול להיות שקשור לחברה שלך.\nתוכן.")).toContain("opener_mush");
  });
});

/**
 * whyHim (the veto's sentence) is INPUT to the drafting prompt, which already says
 * "rephrased in your own everyday words". The shipped draft's closer just swapped the
 * pronouns from third to second person — this makes that rule enforceable.
 */
describe("whyHimCopied", () => {
  const WHY_HIM =
    "תמיר הוא זה שחותם בפועל על בחירת מודלי ה-ML לתמחור בפניקס, ולכן שאלת המשתנים הפרוקסי והאפליה העקיפה " +
    "היא סיכון שהוא נושא בעצמו בהחלטה — לא נושא כללי של תעשיית הביטוח.";

  it("is true for the shipped draft's closer against the real whyHim", () => {
    const message =
      "גיל, נתקלתי במחקר.\nחברות ביטוח משתמשות בנתונים.\n" +
      "בגלל שאתה זה שמחליט בפועל על המודלים של ML לתמחור בפניקס, הסיכון של משתנים פרוקסי והאפליה העקיפה " +
      "היא בעצם סיכון שאתה נושא בעצמו בהחלטה.\n" +
      "https://streamlinefeed.co.ke/news/unconventional-data-exposes-consumers-to-algorithmic-pricing-discrimination";
    expect(whyHimCopied(message, WHY_HIM)).toBe(true);
  });

  it("is false for a genuinely rephrased closer", () => {
    const message =
      "גיל, נתקלתי במחקר.\nחברות ביטוח משתמשות בנתונים.\n" +
      "אתה זה שבוחר את המודלים, אז ההטיה הזאת נופלת עליך ולא על התעשייה.\n" +
      "https://example.com/story";
    expect(whyHimCopied(message, WHY_HIM)).toBe(false);
  });

  it("is false when whyHim is empty or absent", () => {
    expect(whyHimCopied("כל הודעה", "")).toBe(false);
    expect(whyHimCopied("כל הודעה", null)).toBe(false);
    expect(whyHimCopied("כל הודעה", undefined)).toBe(false);
  });

  it("checkDraft raises whyhim_copied when ctx.whyHim is passed and the closer is copied", () => {
    const message =
      "גיל, נתקלתי במחקר.\nחברות ביטוח משתמשות בנתונים.\n" +
      "בגלל שאתה זה שמחליט בפועל על המודלים של ML לתמחור בפניקס, הסיכון של משתנים פרוקסי והאפליה העקיפה " +
      "היא בעצם סיכון שאתה נושא בעצמו בהחלטה.";
    expect(checkDraft(message, { whyHim: WHY_HIM })).toContain("whyhim_copied");
  });

  it("checkDraft without ctx never raises whyhim_copied — existing call sites keep working", () => {
    const message =
      "בגלל שאתה זה שמחליט בפועל על המודלים של ML לתמחור בפניקס, הסיכון של משתנים פרוקסי והאפליה העקיפה " +
      "היא בעצם סיכון שאתה נושא בעצמו בהחלטה.";
    expect(checkDraft(message)).not.toContain("whyhim_copied");
  });

  /**
   * Fix round 1: the em-dash strip that gets the real pair over 0.6 was applied to
   * BOTH inputs — but the drafting prompt's own rule 3 actively encourages exactly this
   * shape for an honest closer ("anchor it in their world by naming ONE concrete thing
   * of theirs"). An honest closer using an em-dash must not lose its own anchor before
   * comparison; only whyHim's trailing scope caveat gets dropped.
   */
  it("does not flag an honest closer that uses an em-dash of its own", () => {
    const whyHim = "הוא מנהל את הסיכונים הרגולטוריים בפניקס.";
    const message =
      "גיל, ראיתי משהו.\nתוכן.\n" +
      "הסיכונים הרגולטוריים בפניקס — זה נופל עליך ולא על מישהו אחר בשוק, וזה בדיוק מה שמעניין כאן.\n" +
      "https://example.com/story";
    expect(whyHimCopied(message, whyHim)).toBe(false);
    expect(checkDraft(message, { whyHim })).not.toContain("whyhim_copied");
  });
});

/**
 * Two real errors from the same draft: "אלגוריתמים האלה" (demonstrative needs the
 * definite article) and "והאפליה העקיפה היא" (a coordinated subject taking a singular
 * feminine copula). Soft only — a false positive must never kill a good draft.
 */
describe("hebrewAgreementErrors", () => {
  it("finds the definite_demonstrative error", () => {
    const errs = hebrewAgreementErrors("אלגוריתמים האלה מזהים משתנים קורלטיביים שיוצרים אפליה עקיפה");
    expect(errs.map((e) => e.kind)).toContain("definite_demonstrative");
  });

  it("finds the compound_subject_singular_copula error", () => {
    const errs = hebrewAgreementErrors(
      "הסיכון של משתנים פרוקסי והאפליה העקיפה היא בעצם סיכון שאתה נושא בעצמו בהחלטה"
    );
    expect(errs.map((e) => e.kind)).toContain("compound_subject_singular_copula");
  });

  it("returns [] for a correctly-formed definite demonstrative", () => {
    expect(hebrewAgreementErrors("האלגוריתמים האלה מזהים")).toEqual([]);
  });

  it("returns [] for a correctly-agreeing compound subject", () => {
    expect(hebrewAgreementErrors("הסיכון והאפליה הם")).toEqual([]);
  });
});
