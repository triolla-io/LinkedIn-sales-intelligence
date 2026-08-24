/**
 * Mechanical checks on a finished draft, derived from the first production run
 * (2026-08-20). Every rule here fired on a real message that the prompt already
 * forbade — which is the point: a prompt rule with no check is a suggestion.
 *
 * Pure. No prisma, no LLM. Used by the Plans 2-4 acceptance tests, and intended as
 * the gate on the drafting stage once the archetype swap is verified in the pilot.
 *
 * These are NECESSARY, not sufficient. A draft with zero violations can still be a
 * bad draft; only the veto judges whether it should exist at all.
 */

export type DraftViolation =
  /** The v1 archetype: suggesting they adopt, integrate or evaluate the thing. */
  | "adoption_suggestion"
  /** Any ask — a question, a meeting, a "let's talk". The v2 message expects nothing back. */
  | "ask"
  /** Selling us instead of forwarding an item. */
  | "self_pitch"
  /** "...שלכם אצלכם" — two possessives for one noun. Appeared in 3 of 11 drafts. */
  | "duplicate_possessive"
  /** A Hebrew letter touching a Latin one with no separator: "שProtoPie", "לprototyping". */
  | "glued_script"
  | "emoji";

/**
 * Phrases, not vibes. Each pattern is anchored on wording that actually appeared, so a
 * regression names itself instead of producing a vague low score.
 */
const RULES: { code: DraftViolation; pattern: RegExp }[] = [
  { code: "adoption_suggestion", pattern: /אולי\s+תוכל(?:ו|י)?\s+לשלב|כדאי\s+ל(?:בדוק|שקול|הסתכל)|שווה\s+ל(?:בדוק|הסתכל)|ממליץ\s+ל/u },
  { code: "ask", pattern: /מה\s+דעת(?:ך|כם)|א?שמח\s+לשמוע|נשמח\s+לשמוע|בוא(?:י)?\s+נ(?:דבר|קבע)|שיחה\s+קצרה|מעניין\s+אות(?:ך|כם)|\?/u },
  { code: "self_pitch", pattern: /אנחנו\s+(?:יכולים|עושים)|נוכל\s+לעזור|השירות\s+שלנו|החברה\s+שלנו|אצלנו\s+ב/u },
  { code: "duplicate_possessive", pattern: /של(?:כם|כן|ך|ו|ה)\s+אצל(?:כם|כן|ך|ו|ה)/u },
  // Direct adjacency of the two scripts is always a typography failure in Hebrew —
  // correct text uses a hyphen ("ב-MCP") or a space.
  { code: "glued_script", pattern: /[֐-׿][A-Za-z]|[A-Za-z][֐-׿]/u },
  { code: "emoji", pattern: /\p{Extended_Pictographic}/u },
];

/** Every rule the message breaks, in a stable order. Empty means it passed. */
export function checkDraft(message: string): DraftViolation[] {
  const text = typeof message === "string" ? message : "";
  return RULES.filter((r) => r.pattern.test(text)).map((r) => r.code);
}

export type HardEditViolation =
  /** A URL that is not the article's own address. Tracking wrappers included. */
  | "foreign_link"
  /** A figure the source text never said. The claim has no provenance. */
  | "unsourced_figure";

export type EditCheck = { hard: HardEditViolation[]; soft: DraftViolation[] };

const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/**
 * Every digit-group in the prose appears in the source's own words. Digits inside the
 * canonical URL are the link, not a claim. Shared by the edit gate and by the approvals
 * screen's "העובדות אומתו" chip, so the two can never disagree.
 */
export function figuresSourced(message: string, sourceText: string, canonicalUrl: string | null): boolean {
  const prose = canonicalUrl ? message.split(canonicalUrl).join(" ") : message;
  const figures = prose.match(/\d[\d.,]*/g) ?? [];
  return figures.every((f) => sourceText.includes(f.replace(/[.,]+$/, "")));
}

/**
 * The gate for a HUMAN edit — two tiers, unlike checkDraft which is the machine's gate.
 * HARD violations block the save: the link must be the article's own address and a
 * figure must exist in the source. Everything checkDraft flags becomes a SOFT warning:
 * the message is the user's, and an edit blocked over taste teaches them to abandon the
 * screen, not to write better.
 */
export function checkDraftEdit(
  message: string,
  opts: { canonicalUrl: string | null; sourceText: string }
): EditCheck {
  const hard: HardEditViolation[] = [];
  const urls = message.match(URL_RE) ?? [];
  if (urls.some((u) => u !== opts.canonicalUrl)) hard.push("foreign_link");
  if (!figuresSourced(message, opts.sourceText, opts.canonicalUrl)) hard.push("unsourced_figure");
  return { hard, soft: checkDraft(message) };
}
