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
  | "emoji"
  /** Past SOFT_DRAFT_CHARS. ADVISORY — a content paragraph legitimately lands here. */
  | "long"
  /** Past MAX_DRAFT_CHARS. Blocking: this has stopped being a message. */
  | "too_long";

/**
 * Phrases, not vibes. Each pattern is anchored on wording that actually appeared, so a
 * regression names itself instead of producing a vague low score.
 */
const RULES: { code: DraftViolation; pattern: RegExp }[] = [
  { code: "adoption_suggestion", pattern: /אולי\s+תוכל(?:ו|י)?\s+לשלב|כדאי\s+ל(?:בדוק|שקול|הסתכל)|שווה\s+ל(?:בדוק|הסתכל)|ממליץ\s+ל/u },
  { code: "ask", pattern: /מה\s+דעת(?:ך|כם)|א?שמח\s+לשמוע|נשמח\s+לשמוע|בוא(?:י)?\s+נ(?:דבר|קבע)|שיחה\s+קצרה|מעניין\s+אות(?:ך|כם)/u },
  { code: "self_pitch", pattern: /אנחנו\s+(?:יכולים|עושים)|נוכל\s+לעזור|השירות\s+שלנו|החברה\s+שלנו|אצלנו\s+ב/u },
  { code: "duplicate_possessive", pattern: /של(?:כם|כן|ך|ו|ה)\s+אצל(?:כם|כן|ך|ו|ה)/u },
  // Direct adjacency of the two scripts is always a typography failure in Hebrew —
  // correct text uses a hyphen ("ב-MCP") or a space.
  { code: "glued_script", pattern: /[֐-׿][A-Za-z]|[A-Za-z][֐-׿]/u },
  { code: "emoji", pattern: /\p{Extended_Pictographic}/u },
];

const URL_RE = /https?:\/\/[^\s<>"')]+/gu;

/**
 * Where the prose stops being a forward and starts being a document. Two tiers on
 * purpose: with an opener, a 2-3 sentence content paragraph and a "why him" line, a good
 * draft lands right around 600 — so 600 can only ADVISE. Blocking there would reject
 * good drafts over two characters. 900 is the real ceiling.
 */
export const SOFT_DRAFT_CHARS = 600;
export const MAX_DRAFT_CHARS = 900;

/**
 * A greeting is not the opening sentence, it precedes it — and a model that puts
 * "היי דנה," on its own line must not lose the draft to a positional rule.
 */
const GREETING = /^\s*(?:היי|הי|שלום|אהלן|בוקר\s+טוב|צהריים\s+טובים)[^\n?.!]{0,24}?[,\n]/u;

/**
 * Everything after the first sentence.
 *
 * Yuval's signature opener IS a question — "היי, ראית את זה?" — so a bare "?" cannot be
 * banned outright. What must never exist is a question that functions as a CTA, and that
 * one always sits past the opener.
 */
function tailAfterOpener(prose: string): string {
  const body = prose.replace(GREETING, "").replace(/^\s+/u, "");
  const end = body.search(/[?.!\n]/u);
  return end === -1 ? "" : body.slice(end + 1);
}

/**
 * Every rule the message breaks, in a stable order. Empty means it passed.
 *
 * The URL is removed before any rule runs: its "?" is not an ask, its letters are not
 * prose, and a tracking-heavy link must not push a legitimate message over a length tier.
 */
export function checkDraft(message: string): DraftViolation[] {
  const text = typeof message === "string" ? message : "";
  const prose = text.replace(URL_RE, " ");
  const out = RULES.filter((r) => r.pattern.test(prose)).map((r) => r.code);

  if (!out.includes("ask") && /\?/u.test(tailAfterOpener(prose))) out.push("ask");

  const len = prose.trim().length;
  if (len > MAX_DRAFT_CHARS) out.push("too_long");
  else if (len > SOFT_DRAFT_CHARS) out.push("long");

  return out;
}

export type AxisLabelViolation =
  | "empty"
  /** Hebrew touching Latin with no separator — the same typography failure as in a draft. */
  | "glued_script"
  | "emoji"
  /** Two spaces where one belongs. Arrives from LinkedIn company names and survives into labels. */
  | "double_space"
  /** A sentence, not a topic. */
  | "too_long"
  /** A label is a noun phrase; it does not end in a full stop or start with a comma. */
  | "stray_punctuation";

/** Beyond this a label has stopped naming a subject and started describing it. */
const MAX_LABEL_CHARS = 60;

/**
 * Mechanical checks on a model-written axis LABEL, which is copy shown on the people and
 * decisions screens.
 *
 * Only the rules that survive the change of context: script, pictographs, structure.
 * `checkDraft`'s ask/self-pitch/adoption rules judge the semantics of a MESSAGE and would
 * reject legitimate topics ("ממליץ לבדוק תשתיות ענן" is odd phrasing, not a violation).
 *
 * Deliberately does NOT catch misspellings — "אבטחה סייבר וגנת" reads clean to every rule
 * here. Spelling needs the axis-merge prompt to proofread its own output.
 */
export function checkAxisLabel(label: string): AxisLabelViolation[] {
  const raw = typeof label === "string" ? label : "";
  const out: AxisLabelViolation[] = [];

  if (!raw.trim()) return ["empty"];

  if (/[֐-׿][A-Za-z]|[A-Za-z][֐-׿]/u.test(raw)) out.push("glued_script");
  if (/\p{Extended_Pictographic}/u.test(raw)) out.push("emoji");
  if (/\S {2,}\S/.test(raw)) out.push("double_space");
  if (raw.trim().length > MAX_LABEL_CHARS) out.push("too_long");
  if (/[.,;:!]$/.test(raw.trim()) || /^[.,;:!]/.test(raw.trim())) out.push("stray_punctuation");

  return out;
}

export type HardEditViolation =
  /** A URL that is not the article's own address. Tracking wrappers included. */
  | "foreign_link"
  /** A figure the source text never said. The claim has no provenance. */
  | "unsourced_figure";

export type EditCheck = { hard: HardEditViolation[]; soft: DraftViolation[] };

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
