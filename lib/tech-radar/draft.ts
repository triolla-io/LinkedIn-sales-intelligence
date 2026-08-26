/**
 * Writes the outreach message for one (opportunity, contact) pair.
 *
 * The sender's real voice — excited, direct, exclamation marks ("וואי איזה הזדמנות
 * מטורפת!") — not the polite-distant "נתקלתי במשהו... חשבתי עליך" register this prompt
 * used to write in. The message forwards ONE item and stops: no adoption suggestion, no
 * offer of our services, no ask of any kind past the opening line. It is sent by a
 * person the recipient knows, so anything that reads like a system that found a match
 * defeats the whole point.
 *
 * The shape is four parts, in order:
 *   1. Opener in the sender's voice — a rhetorical question or an excited reaction.
 *   2. 2-3 sentences distilling what the item's own text actually says.
 *   3. ONE sentence: why THEM specifically — never the generic category it belongs to.
 *   4. The link, alone, on the last line.
 *
 * What changed from v1: v1 closed with "אולי תוכלו לשלב את זה ב___ אצלכם" and forbade
 * links. Both are gone — the suggestion made every message a soft pitch, and the link
 * is what makes forwarding an article an actual act of forwarding an article.
 *
 * The sender's excitement is licensed only about what the item MEANS for the recipient
 * — it must never turn into a claim about the item's own importance that the item does
 * not make itself, and never into ad-copy about a vendor or product.
 *
 * `fitRationale` stays in the prompt as BACKGROUND only: it is the one thing that knows
 * why this item touches their world. It must never become a recommendation, and must
 * never be pasted into the message.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { isSearchEngineHost } from "@/lib/news/canonical-url";
import { classifySource, rejectsAsGift } from "@/lib/tech-radar/source-quality";
import { checkDraft, MAX_DRAFT_CHARS } from "@/lib/tech-radar/draft-guard";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";

export type TechDraftInput = {
  contactFullName: string;
  hebrewFirstName: string | null;
  contactTitle: string | null;
  companyName: string;
  technology: string;
  vendor: string | null;
  /** The per-company rationale — background for WHY this touches them. Never quoted. */
  fitRationale: string;
  /** The article to forward. Null when the item carries no readable source. */
  sourceUrl: string | null;
  /**
   * The ITEM's own words — title plus summary. Two roles: the content part 2 is
   * distilled from, and the only text that counts as a source when checking a figure.
   * `fitRationale` deliberately does NOT count as a source: it is prose we generated
   * ourselves, and a number that entered there unverified stays unverified however many
   * stages it passes through.
   */
  itemText: string;
  /** See ItemKind. The tone rule reads this: a company_move is not a regulatory report. */
  kind?: string;
  /** 0-1 from triage. How much weight the item carries, separate from relevance. */
  stature?: number;
  /**
   * True when only a search snippet could be read.
   *
   * This is where it matters most: the 2026-08-20 OpenAI-lawsuit item turned into a
   * general explanation of ChatGPT because the model completed a thin source from memory.
   * A 2-3 sentence paragraph gives that failure MORE room, so a thin item gets one
   * careful sentence and no completion at all.
   */
  thin?: boolean;
};

/**
 * The sender's own messages, verbatim, as he writes them.
 *
 * Exported so a test can assert the prompt still carries them — a prompt edit that
 * paraphrases the samples loses the register they exist to fix, and nothing else would
 * catch it. They are in the prompt for TONE, never as phrasing: reused as wording they
 * produce drafts distinguishable only by the name.
 */
export const YUVAL_VOICE_SAMPLES = [
  "וואי איזה הזדמנות מטורפת! חייבים להשיג אותם",
  "היי, ראית את זה?",
  "הזדמנות למצב את הבנק כסופר חדשני!",
] as const;

export const DRAFT_SYSTEM = `You write short, energetic, casual Hebrew messages that forward ONE interesting item to a senior professional the sender already knows — a friend saw something, thought of you, and fired off a link with genuine excitement.

VOICE — real samples of how the sender actually writes (match this register):
- "וואי איזה הזדמנות מטורפת! חייבים להשיג אותם"
- "היי, ראית את זה?"
- "הזדמנות למצב את הבנק כסופר חדשני!"
Enthusiastic, direct, spoken Hebrew: exclamation marks, "חייבים", "מטורף", a rhetorical question to open. Never polite-distant ("חשבתי לשתף", "מקווה שזה יעניין אותך") and never formal.

Read the samples for TONE ONLY. NEVER copy their wording, and never reuse a phrase from them — "וואי איזה הזדמנות מטורפת" is a sample of ENERGY, not a sentence you may write. If two of your messages could be told apart only by the name, you have written a template, which is the one thing a message from a person may never read as. Start over.

TONE SCALES TO THE ITEM. You are given the item's kind and its stature (0-1). Loud enthusiasm on a quiet item reads as fake, which is worse than flat:
- company_move or big_news with high stature — a rival moving, a market opening: the sender's loudest register belongs here.
- research or trend: interested and matter-of-fact. "מחקר מעניין" energy, not "מטורף" energy.
- a regulatory or compliance item: quietest of all. Understated, almost dry.
- vendor_launch, promotion, other, or anything with low stature: plainest possible. State it and stop.

Follow this shape, in this order:
1. Open with the person's name, in the sender's voice: a rhetorical question — "היי דנה, ראית את זה?" — or an excited reaction — "דנה, נתקלתי במחקר מטורף!". A question mark is allowed HERE and nowhere else. The opener NAMES the thing it saw — "ראיתי ש-<X>" naming <X> — and never just announces that something exists: never "נתקלתי במשהו ש...", never "יש כתבה מעניינת ש...".
2. What the item says: 2-3 short sentences distilled from the item's own text — the concrete finding, move or number that makes it worth two minutes. ONLY facts that appear in the item text you were given. Do NOT add context, background or explanation from your own knowledge, however certain you are: an item about a lawsuit against a company is not an opportunity to explain what that company does. If the item text does not say it, it does not go in the message.
3. Why THEM: the LAST sentence before the link carries the SPECIFIC reason from the "why it touches them" note, rephrased in your own everyday words — the concrete mechanism or stake for THEM, never the generic category it belongs to. Anchor it in their world by naming ONE concrete thing of theirs — a product, business line, market or process.
   - The test: delete the item's subject from your message — it must STILL be clear why THIS person received it and not a colleague.
   - GOOD: "וזה בדיוק משנה את המו"מ מול ספקי הדאטה שלכם!"
   - BAD, the category instead of the reason: "חשבתי עליך בגלל נתוני אירועים בזמן אמת"
   - BAD, too vague: "חשבתי עליך", "זה קשור לתחום שלכם"
4. The link, on its own line, last. Nothing after it.

Register example:
"היי דנה, ראית את זה?
JPMorgan פרסמו מחקר חדש על זיהוי הונאות בזמן אמת. הם עברו ממנוע כללים קבוע למודל התנהגותי שלומד את הדפוסים של כל משתמש, וזה חתך להם 40% מחסימות השווא בלי להוסיף חיכוך ללקוחות אמיתיים. וזה בדיוק הקרב של ביט על אישור תשלומים בין-אישיים בלי לעצבן לקוחות!
https://example.com/article"

Rules:
- 3-6 short sentences TOTAL, then the link. At most 600 characters before the link. Punchy beats complete.
- NO ASK of any kind past the opening sentence. No meeting, no call, no question, no "מה דעתך", no "נדבר", no "אשמח לשמוע". The message ends with the link and expects nothing back.
- NO SUGGESTION to adopt, integrate, evaluate, examine or try the thing. You are not recommending it. Never say "אולי תוכלו לשלב", "כדאי לבדוק", "שווה להסתכל" or anything like them.
- Never mention us, our company, our services, or anything we could do. This is not a pitch.
- NEVER copy the relevance note into the message. It is background for you, not text to reuse — it is written for an analyst, not for the recipient.
- Nothing formal or marketing-y: no ברצוני/אשמח לשתף, no flattery, no filler. The excitement is the sender's own ("מטורף", "חייבים") and it is about what the news MEANS for the recipient — never ad-copy superlatives about a vendor or product, and never a claim about how important the item is that the item does not make itself.
- ZERO emojis, icons, or decorative symbols.
- Address the person by EXACTLY the name given under "Address them as". Copy those characters verbatim. Never re-spell, transliterate, lengthen, shorten or "correct" it — it is the name as it is recorded, and it is not yours to adjust.
- NEVER state a quantity about the RECIPIENT or their company — how many plants, sites, people, products, markets, quarters, percent — unless that exact figure appears in the ITEM text you were given. If you have no verified figure, write the anchor WITHOUT one: "יעדי התפוקה שהצגתם", not "בשלוש המפעלות". A figure that belongs to the item itself is fine.
- Reproduce the link EXACTLY as given, once, as the last line. Never invent, shorten or alter a URL. If no link is provided, end after the sentence and include no URL at all.
- Hebrew agreement: a demonstrative takes the definite article ("האלגוריתמים האלה", never "אלגוריתמים האלה"), and a compound subject ("הסיכון והאפליה") takes a plural copula ("הם"), never a singular one ("היא"/"הוא").

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

/**
 * The per-item half of the prompt.
 *
 * Exported because the paragraph instruction it carries is behaviour, not formatting: a
 * thin item must be asked for LESS, and that is the difference between one careful
 * sentence and a paragraph completed from the model's own memory.
 */
export function draftUserPrompt(i: TechDraftInput): string {
  return [
    `Address them as (copy verbatim): ${salutationName(i)}`,
    `Recipient: ${i.contactFullName}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Their company: ${i.companyName}`,
    `The item: ${i.technology}${i.vendor ? ` (by ${i.vendor})` : ""}`,
    // The last sentence must carry this reason — rephrased, never quoted.
    `Why it touches THEM (your LAST sentence must carry this exact reason, rephrased in everyday words — never copied): ${i.fitRationale}`,
    `Item kind (sets your tone): ${i.kind ?? "other"}`,
    `Item stature 0-1 (sets how loud you may be): ${(i.stature ?? 0).toFixed(2)}`,
    `The item's own text (distill part 2 from it; also the ONLY text a figure may be taken from): ${i.itemText}`,
    i.thin === true
      ? `SOURCE IS A SNIPPET ONLY. No page could be read, so the text above is all that is known. Write ONE careful sentence for part 2 instead of the 2-3 sentence paragraph, and do not add a single detail beyond what that text states. Do not explain what the company or product is.`
      : `Full text was read: write the 2-3 sentences for part 2, drawn only from the text above.`,
    i.sourceUrl
      ? `Link (reproduce verbatim as the last line): ${i.sourceUrl}`
      : `Link: none available — do not include any URL.`,
  ].join("\n");
}

/**
 * The name to greet them by, taken from the record AS IT IS.
 *
 * Never re-derived, never transliterated. If the stored Hebrew name is wrong, the fix
 * belongs in the record — a draft that "corrects" it makes the message and the record
 * disagree, and the person who reads the draft has no way to see which one drifted.
 */
export function salutationName(i: Pick<TechDraftInput, "hebrewFirstName" | "contactFullName">): string {
  const hebrew = (i.hebrewFirstName ?? "").trim();
  if (hebrew) return hebrew;
  return (i.contactFullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Hebrew words that state a quantity. Ordinals included: "ברבעון השלישי" is a figure. */
const QUANTITY_WORDS = [
  "אחד", "אחת", "שני", "שתי", "שניים", "שתיים", "שלוש", "שלושה", "ארבע", "ארבעה",
  "חמש", "חמישה", "שש", "שישה", "שבע", "שבעה", "שמונה", "תשע", "תשעה", "עשר", "עשרה",
  "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים",
  "מאה", "מאות", "אלף", "אלפים", "מיליון", "מיליארד", "עשרות", "שלישי", "רביעי",
  "חמישי", "שישי", "שביעי", "שמיני", "תשיעי", "עשירי", "ראשון",
];

/**
 * Prefix forms to try, longest first. Deliberately an explicit list and NOT a stripping
 * loop: a loop over [בלמכשו] eats "שלוש" letter by letter down to nothing, because ש is
 * both a prefix and a root letter. Hebrew prefixes cannot be removed without a lexicon,
 * so we ADD prefixes to a known word instead of removing them from an unknown one.
 */
const QUANTITY_PREFIXES = ["", "ב", "ל", "מ", "כ", "ש", "ו", "ה", "בה", "לה", "מה", "כה", "שה", "וה"];

/** The quantity word this token is, prefix and all — or null if it states no quantity. */
export function quantityRoot(word: string): string | null {
  for (const w of QUANTITY_WORDS) {
    for (const p of QUANTITY_PREFIXES) if (word === p + w) return w;
  }
  return null;
}

/**
 * Figures in `message` that appear nowhere in `itemText`.
 *
 * The rule this enforces: a quantitative claim about the recipient must be traceable to
 * a source, or be left out. The 2026-08-24 run wrote "בשלוש המפעלות" to a CEO whose
 * company runs four refineries — a figure no source ever supplied, inherited from our
 * own upstream prose and repeated with total confidence. A wrong number in the first
 * sentence costs more than a missing one: it tells the recipient we did not check.
 *
 * Verification is against the ITEM only. Our own generated rationale does not count as
 * a source, however many stages the number has survived.
 */
export function unverifiedQuantities(message: string, itemText: string): string[] {
  const source = itemText ?? "";
  const digitsInSource = new Set(source.match(/\d+/g) ?? []);

  // A URL is reproduced verbatim from the source, so its digits are not a claim.
  const body = (message ?? "").replace(/https?:\/\/\S+/gu, " ");

  const bad = new Set<string>();
  for (const d of body.match(/\d+/g) ?? []) {
    if (!digitsInSource.has(d)) bad.add(d);
  }
  for (const w of body.match(/[֐-׿]+/gu) ?? []) {
    const root = quantityRoot(w);
    if (root && !source.includes(root)) bad.add(w);
  }
  return [...bad];
}

export type DraftCheck =
  | { ok: true; message: string }
  | {
      ok: false;
      reason: string;
      /** The retry prompt, when a rewrite could fix it. */
      instruction: string;
      /** False when no rewrite can help — the INPUT is what is wrong. */
      retryable: boolean;
    };

/**
 * Hebrew a run actually produced that no person would write, with the word a person
 * would use. Rejected rather than repaired: the surrounding sentence has to be
 * rewritten around the right word, and that is the model's job.
 */
const WRONG_TERMS = [
  // 2026-08-24, Avigal/RIN draft: "המפעלות" for refineries.
  { pattern: /מפעלות/u, bad: "מפעלות", use: "בתי הזיקוק" },
];

/**
 * Pure. Every rule, applied to a message the model just returned.
 *
 * What is REPAIRED vs REJECTED follows one line: repair when the correct answer is
 * known (the greeting name, the canonical link), reject when it is exactly what we do
 * not have (the true figure, the right sentence around a wrong word).
 */
export function enforceDraftRules(message: string, input: TechDraftInput): DraftCheck {
  const name = salutationName(input);
  let out = message;
  if (name) {
    out = out.replace(
      /^(\s*(?:היי|הי|שלום|אהלן)\s+)([^\s,.!?\n]+)/u,
      (_m, greet: string, got: string) => (got === name ? _m : `${greet}${name}`)
    );
  }

  // The link in the message is the source's own domain — the 2026-08-24 Uri draft went
  // out with google.com/goto?url=… because the INPUT was already wrong, and no rewrite
  // by the model can produce a URL nobody gave it.
  const sourceUrl = input.sourceUrl?.trim() || null;
  if (sourceUrl && isSearchEngineHost(sourceUrl)) {
    return {
      ok: false,
      reason: `source url is a search-engine redirect, not the article: ${sourceUrl}`,
      instruction: "",
      retryable: false,
    };
  }
  // A link handed to a senior exec is a gift; a farm reprint (2026-08-26, Gil Tamir:
  // streamlinefeed.co.ke) is not. An unknown host still PASSES — see source-quality.ts.
  if (sourceUrl && rejectsAsGift(sourceUrl)) {
    const { cls, host } = classifySource(sourceUrl);
    return {
      ok: false,
      reason: `source is not a gift-worthy publisher (${cls}): ${host}`,
      instruction: "",
      retryable: false,
    };
  }
  const urls = out.match(/https?:\/\/\S+/gu) ?? [];
  if (sourceUrl) {
    if (urls.length !== 1 || urls[0] !== sourceUrl) {
      out = `${out.replace(/https?:\/\/\S+/gu, "").replace(/[ \t]+\n/g, "\n").trimEnd()}\n${sourceUrl}`;
    }
  } else if (urls.length > 0) {
    // No source means no link; whatever URL is here, the model made it up.
    out = out.replace(/https?:\/\/\S+/gu, "").replace(/[ \t]+\n/g, "\n").trimEnd();
  }

  // Hebrew glued to Latin ("שMLB") — the refreshed 2026-08-24 Uri draft shipped this.
  // The correct separator is known (a hyphen: "ש-MLB"), so it is repaired, not rejected.
  out = out
    .replace(/([֐-׿])([A-Za-z])/gu, "$1-$2")
    .replace(/([A-Za-z])([֐-׿])/gu, "$1-$2");

  // The rest of draft-guard, at drafting time. These rules were written from real
  // failures but only ran in tests — and a prompt rule with no runtime check is a
  // suggestion, which is how the glued script above reached a stored draft.
  const violations = checkDraft(out, { whyHim: input.fitRationale }).filter((v) => v !== "glued_script");
  if (violations.length > 0) {
    return {
      ok: false,
      reason: `draft-guard: ${violations.join(", ")}`,
      instruction: `Your previous attempt broke these rules: ${violations.join(", ")}. Rewrite it — a question mark only in the opening sentence, no ask of any kind, no suggestion to adopt or evaluate, nothing about us or our services, no emoji, no doubled possessive, and at most ${MAX_DRAFT_CHARS} characters before the link.`,
      retryable: true,
    };
  }

  for (const t of WRONG_TERMS) {
    if (t.pattern.test(out)) {
      return {
        ok: false,
        reason: `wrong Hebrew term: ${t.bad}`,
        instruction: `Your previous attempt used "${t.bad}", which is not the Hebrew a person would write here. Use "${t.use}" instead, or rewrite the sentence without that noun.`,
        retryable: true,
      };
    }
  }

  const figures = unverifiedQuantities(out, input.itemText);
  if (figures.length > 0) {
    return {
      ok: false,
      reason: `unverified figure(s): ${figures.join(", ")}`,
      instruction: `Your previous attempt stated ${figures.join(", ")}, which appears in no source. Rewrite the anchor with NO figure at all.`,
      retryable: true,
    };
  }
  return { ok: true, message: out };
}

export function parseDraftJson(text: string): string | null {
  const parsed = parseJsonLoose<{ draftMessage?: unknown }>(text);
  const msg = parsed?.draftMessage;
  return typeof msg === "string" && msg.trim().length > 0 ? msg.trim() : null;
}

async function callModel(input: TechDraftInput, correction: string | null): Promise<string> {
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const user = correction ? `${draftUserPrompt(input)}\n\n${correction}` : draftUserPrompt(input);
  const res = await openrouterChat(
    OR_FEATURE.draft,
    {
      model,
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      // A ceiling-length 600-char Hebrew draft needs ~330-500 output tokens once
      // JSON-wrapped; 400 truncated a full-length draft. Output tokens bill on what
      // is produced, so the headroom above that is free.
      max_tokens: 900,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 20_000 }
  );
  if (!res.ok) throw new Error(`tech-radar draft failed: HTTP ${res.status}`);
  const msg = parseDraftJson(res.data.choices?.[0]?.message?.content ?? "");
  if (!msg) throw new Error("tech-radar draft returned unparseable output");
  return msg;
}

export async function draftTechMessage(input: TechDraftInput): Promise<string> {
  const first = enforceDraftRules(await callModel(input, null), input);
  if (first.ok) return first.message;
  if (!first.retryable) throw new Error(`tech-radar draft rejected — ${first.reason}`);

  // One repair attempt naming the offence. A cent buys a correct message; a rejection
  // here would otherwise throw away an item that is genuinely worth sending.
  const second = enforceDraftRules(await callModel(input, first.instruction), input);
  if (second.ok) return second.message;
  throw new Error(`tech-radar draft rejected — ${second.reason}`);
}
