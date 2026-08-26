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
  /** Over MAX_DRAFT_CHARS, excluding the URL — the backstop once the message grows to a paragraph. */
  | "too_long"
  /**
   * The opener names nothing: a placeholder noun ("משהו", "נושא"...) with a hedge
   * ("כנראה", "אולי"...), or a placeholder noun with no concrete noun anywhere in the
   * opener. 2026-08-26, Gil Tamir: "נתקלתי במחקר על משהו שכנראה קשור ישירות לבחירות שלך".
   */
  | "opener_mush"
  /**
   * The last sentence before the link is the veto's whyHim sentence with the pronouns
   * swapped from third to second person, not a genuine rephrasing.
   */
  | "whyhim_copied";

/**
 * Phrases, not vibes. Each pattern is anchored on wording that actually appeared, so a
 * regression names itself instead of producing a vague low score.
 */
const RULES: { code: DraftViolation; pattern: RegExp }[] = [
  { code: "adoption_suggestion", pattern: /אולי\s+תוכל(?:ו|י)?\s+לשלב|כדאי\s+ל(?:בדוק|שקול|הסתכל)|שווה\s+ל(?:בדוק|הסתכל)|ממליץ\s+ל/u },
  // The last two alternatives cover "no meeting request, ever": the positional rule
  // below only catches a question with a boundary before it, and once the model writes
  // the 3-6 sentence body the prompt now requires, that boundary always exists — so a
  // meeting ask phrased this way must be caught here, by wording, not by position.
  { code: "ask", pattern: /מה\s+דעת(?:ך|כם)|א?שמח\s+לשמוע|נשמח\s+לשמוע|בוא(?:י)?\s+נ(?:דבר|קבע)|שיחה\s+קצרה|מעניין\s+אות(?:ך|כם)|יש\s+ל(?:ך|כם)\s+זמן|נוכל\s+ל(?:היפגש|דבר)/u },
  { code: "self_pitch", pattern: /אנחנו\s+(?:יכולים|עושים)|נוכל\s+לעזור|השירות\s+שלנו|החברה\s+שלנו|אצלנו\s+ב/u },
  { code: "duplicate_possessive", pattern: /של(?:כם|כן|ך|ו|ה)\s+אצל(?:כם|כן|ך|ו|ה)/u },
  // Direct adjacency of the two scripts is always a typography failure in Hebrew —
  // correct text uses a hyphen ("ב-MCP") or a space.
  { code: "glued_script", pattern: /[֐-׿][A-Za-z]|[A-Za-z][֐-׿]/u },
  { code: "emoji", pattern: /\p{Extended_Pictographic}/u },
];

/**
 * Two tiers, and the split is the point. With an opener, a 2-3 sentence content paragraph
 * and a "why him" line, a good draft lands right around 600 — so 600 can only ADVISE.
 * Blocking there would reject good drafts over two characters, in the one run whose whole
 * purpose was volume. 900 is where a message has stopped being a message.
 */
export const SOFT_DRAFT_CHARS = 600;
export const MAX_DRAFT_CHARS = 900;

/**
 * A greeting is not the opening sentence, it precedes it. A model that puts "היי דנה," on
 * its own line must not lose the draft to a positional rule — the newline would otherwise
 * end the opener before the hook, and the hook's question mark would read as a tail ask.
 */
const GREETING = /^\s*(?:היי|הי|שלום|אהלן|בוקר\s+טוב|צהריים\s+טובים)[^\n?.!]{0,24}?[,\n]\s*/u;

/**
 * Small and named, shared by the opener check and whyHimCopied below: words that carry
 * no content of their own, so their presence (or a mapped equivalent) must never count
 * as "the opener/closer named something".
 */
const HEBREW_FUNCTION_WORDS = ["של", "את", "על", "זה", "היא", "הוא", "ש", "ו", "כי", "לכן", "בגלל", "בפועל", "בעצם", "לא", "גם"];

/** Nouns that stand in for the subject instead of naming it. */
const OPENER_PLACEHOLDER_PATTERN = /משהו|דבר\s+מה|נושא|עניין|כתבה\s+מעניינת|דבר\s+מעניין/u;
/** Hedges — "probably", "maybe" — that soften a claim instead of making one. */
const OPENER_HEDGE_PATTERN = /כנראה|אולי|נראה\s+לי|יכול\s+להיות\s+ש|בטח|כמדומני/u;

/**
 * True once the placeholder is stripped and nothing longer than 3 Hebrew letters is
 * left outside the function-word list — i.e. the opener has no concrete noun, quoted
 * phrase, or Latin-script token (a product/company name) to anchor it.
 */
function openerHasConcreteNoun(opener: string): boolean {
  if (/[A-Za-z]/.test(opener)) return true;
  if (/["'“”׳״][^"'“”׳״]+["'“”׳״]/u.test(opener)) return true;
  const stripped = opener.replace(OPENER_PLACEHOLDER_PATTERN, " ").replace(OPENER_HEDGE_PATTERN, " ");
  const words = stripped.match(/[֐-׿]+/gu) ?? [];
  return words.some((w) => w.length > 3 && !HEBREW_FUNCTION_WORDS.includes(w));
}

/**
 * "נתקלתי במחקר על משהו שכנראה קשור ישירות לבחירות שלך" — a placeholder noun with a
 * hedge, or a placeholder noun with nothing concrete anywhere else, is the mush shape:
 * it announces that something exists without saying what it is.
 */
function openerMush(opener: string): boolean {
  if (!OPENER_PLACEHOLDER_PATTERN.test(opener)) return false;
  if (OPENER_HEDGE_PATTERN.test(opener)) return true;
  return !openerHasConcreteNoun(opener);
}

/** Every rule the message breaks, in a stable order. Empty means it passed. */
export function checkDraft(message: string, ctx?: { whyHim?: string | null }): DraftViolation[] {
  const raw = typeof message === "string" ? message : "";
  // URLs are not prose: their "?" is not an ask and their length is not the
  // reader's burden.
  const text = raw.replace(/https?:\/\/\S+/gu, " ");
  const out = RULES.filter((r) => r.pattern.test(text)).map((r) => r.code);
  // A rhetorical question may OPEN the message (the sender's real voice); a
  // question anywhere later is an ask — the no-CTA guarantee lives on the tail
  // of the message, not on its opener.
  // A "." between digits is a decimal point, not a sentence end — funding figures
  // and version numbers are ordinary content here. Anything else after it, including
  // no space at all, still ends the sentence: a run-on must not hide a later ask.
  const body = text.replace(GREETING, "");
  const boundary = body.search(/\?|\n|[.!](?![0-9])/u);
  const tail = boundary === -1 ? "" : body.slice(boundary + 1);
  // An opener is only an opener if something follows it. A message that IS one
  // question (its "?" is the last character) has no tail at all, and without this
  // check that lone question mark would exempt itself from ever being an ask.
  if (body.includes("?") && !/\S/.test(tail) && !out.includes("ask")) out.push("ask");
  if (tail.includes("?") && !out.includes("ask")) out.push("ask");
  const opener = boundary === -1 ? body : body.slice(0, boundary);
  if (openerMush(opener)) out.push("opener_mush");
  if (whyHimCopied(raw, ctx?.whyHim)) out.push("whyhim_copied");
  const len = text.replace(/\s+/gu, " ").trim().length;
  if (len > MAX_DRAFT_CHARS) out.push("too_long");
  else if (len > SOFT_DRAFT_CHARS) out.push("long");
  return out;
}

/** The message's sentences, URL and greeting excluded, in order — last one is the closer. */
function messageSentences(message: string): string[] {
  const text = (message ?? "").replace(/https?:\/\/\S+/gu, " ").replace(GREETING, "");
  return text
    .split(/\n|[.!?](?![0-9])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** אתה↔הוא, שלך↔שלו — the second→third-person swap this rule exists to catch. */
const WHYHIM_PRONOUN_MAP: Record<string, string> = { אתה: "הוא", שלך: "שלו" };

/**
 * ה/ו are almost never root-initial on a common noun, so they strip unconditionally.
 * ש is frequently a ROOT letter ("שאלה"), not a prefix — stripping it blind corrupts
 * real words, so it only comes off when what's left IS a known function word or "אתה"
 * (i.e. the relative-pronoun "ש-" glued to a word we already handle, like "שאתה" or
 * "שהוא"). Content verbs like "שמחליט"/"שחותם" keep their ש and simply don't match,
 * which is correct — they are genuinely different words.
 */
function stripLeadingShin(word: string): string {
  if (word[0] !== "ש" || word.length < 2) return word;
  const rest = word.slice(1);
  return HEBREW_FUNCTION_WORDS.includes(rest) || rest === "אתה" ? rest : word;
}

const GENERIC_PREFIXES = ["ה", "ו"];
/** Plural (ים/ות) and construct-state (י) endings — enough to fold "מודלים"/"מודלי" together. */
const NOUN_SUFFIXES = ["ים", "ות", "י"];

function normalizeHebrewWord(raw: string): string {
  let w = stripLeadingShin(raw);
  w = WHYHIM_PRONOUN_MAP[w] ?? w;
  if (w.length > 3 && GENERIC_PREFIXES.includes(w[0])) w = w.slice(1);
  for (const suf of NOUN_SUFFIXES) {
    if (w.length > 3 + suf.length && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

/**
 * Hebrew content tokens: punctuation and niqqud stripped, a trailing em-dash aside
 * dropped (a veto sentence like "...הוא נושא בעצמו בהחלטה — לא נושא כללי של תעשיית
 * הביטוח" ends on a scope caveat for the JUDGE, not part of the reason a rephrased
 * closer would ever echo), function words dropped, pronouns normalized, light noun
 * stemming applied.
 */
function whyHimContentTokens(text: string): Set<string> {
  const core = (text ?? "").split("—")[0];
  const noNiqqud = core.replace(/[֑-ׇ]/gu, "");
  const words = noNiqqud.match(/[֐-׿]+/gu) ?? [];
  const mapped = words.map(normalizeHebrewWord);
  return new Set(mapped.filter((w) => w.length > 1 && !HEBREW_FUNCTION_WORDS.includes(w)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/** `>=` this and the closer counts as the whyHim sentence with the pronouns swapped. */
export const WHYHIM_JACCARD_THRESHOLD = 0.6;

/**
 * True when the message's LAST sentence before the link is whyHim (the veto's
 * person-specific reason) re-inflected from third to second person rather than
 * genuinely rephrased. The prompt already says "rephrased in your own everyday words" —
 * this makes that enforceable.
 */
export function whyHimCopied(message: string, whyHim: string | null | undefined): boolean {
  if (!whyHim || !whyHim.trim()) return false;
  const sentences = messageSentences(message);
  const closer = sentences[sentences.length - 1];
  if (!closer) return false;
  const a = whyHimContentTokens(closer);
  const b = whyHimContentTokens(whyHim);
  return jaccard(a, b) >= WHYHIM_JACCARD_THRESHOLD;
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
