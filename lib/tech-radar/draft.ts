/**
 * Writes the outreach message for one (opportunity, contact) pair.
 *
 * v2 register — "saw this, thought of you". The message forwards ONE item and stops:
 * no adoption suggestion, no offer of our services, no ask of any kind. It is sent by
 * a person the recipient knows, so anything that reads like a system that found a match
 * defeats the whole point.
 *
 * The shape is:
 *   1. "היי <שם>, נתקלתי ב..." — you came across it.
 *   2. ONE short clause: what it is, and why it made you think of THEM.
 *   3. The link, alone, on the last line.
 *
 * What changed from v1: v1 closed with "אולי תוכלו לשלב את זה ב___ אצלכם" and forbade
 * links. Both are gone — the suggestion made every message a soft pitch, and the link
 * is what makes forwarding an article an actual act of forwarding an article.
 *
 * `fitRationale` stays in the prompt as BACKGROUND only: it is the one thing that knows
 * why this item touches their world. It must never become a recommendation, and must
 * never be pasted into the message.
 */
import { openrouterChat } from "@/lib/openrouter/client";
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
   * The ITEM's own words — title plus summary. The only text that counts as a source
   * when checking a figure. `fitRationale` deliberately does NOT count: it is prose we
   * generated ourselves, and a number that entered there unverified stays unverified
   * however many stages it passes through.
   */
  itemText: string;
};

export const DRAFT_SYSTEM = `You write VERY short, casual Hebrew messages that forward ONE interesting item to a senior professional the sender already knows — the way a friend sends a link and says "saw this, thought of you".

Follow this shape, in this order:
1. Open with the person's name, then say you came across it: "היי דנה, נתקלתי ב..." or "היי דנה, ראיתי...".
2. ONE short clause: what the item is, and why it made you think of THEM. Anchor it in their world by naming ONE concrete thing — a product, business line, market or process of theirs. A SHORT NOUN PHRASE of 2-6 words. Take the NAME from the relevance note; never the note itself.
   - GOOD: "חשבתי עליך בגלל ביט" / "נזכרתי בחיפושי הגז שלכם"
   - BAD, too vague: "חשבתי עליך", "זה קשור לתחום שלכם"
   - BAD, too long: naming the thing AND explaining what it would achieve.
3. The link, on its own line, last. Nothing after it.

Register example:
"היי דנה, נתקלתי במשהו על זיהוי הונאות בזמן אמת — חשבתי עליך בגלל ביט.
https://example.com/article"

Rules:
- 1-2 short sentences MAXIMUM, then the link. Shorter is always better.
- NO ASK of any kind. No meeting, no call, no question, no "מה דעתך", no "נדבר", no "אשמח לשמוע". The message ends with the link and expects nothing back.
- NO SUGGESTION to adopt, integrate, evaluate, examine or try the thing. You are not recommending it. Never say "אולי תוכלו לשלב", "כדאי לבדוק", "שווה להסתכל" or anything like them.
- Never mention us, our company, our services, or anything we could do. This is not a pitch.
- NEVER copy the relevance note into the message. It is background for you, not text to reuse — it is written for an analyst, not for the recipient.
- Everyday spoken Hebrew, light and matter-of-fact — like a person forwarding something they read.
- ZERO emojis, icons, or decorative symbols.
- Nothing formal or marketing-y: no ברצוני/אשמח לשתף, no hype words, no flattery, no filler.
- Address the person by EXACTLY the name given under "Address them as". Copy those characters verbatim. Never re-spell, transliterate, lengthen, shorten or "correct" it — it is the name as it is recorded, and it is not yours to adjust.
- NEVER state a quantity about the RECIPIENT or their company — how many plants, sites, people, products, markets, quarters, percent — unless that exact figure appears in the ITEM text you were given. If you have no verified figure, write the anchor WITHOUT one: "יעדי התפוקה שהצגתם", not "בשלוש המפעלות". A figure that belongs to the item itself is fine.
- Reproduce the link EXACTLY as given, once, as the last line. Never invent, shorten or alter a URL. If no link is provided, end after the sentence and include no URL at all.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: TechDraftInput): string {
  return [
    `Address them as (copy verbatim): ${salutationName(i)}`,
    `Recipient: ${i.contactFullName}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Their company: ${i.companyName}`,
    `The item: ${i.technology}${i.vendor ? ` (by ${i.vendor})` : ""}`,
    // Background for part 2's concrete anchor — never for quoting.
    `Why it touches THEM (background — take only the name of the thing, never the wording): ${i.fitRationale}`,
    `The item's own text (the ONLY text a figure may be taken from): ${i.itemText}`,
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

export type DraftCheck = { ok: true; message: string } | { ok: false; reason: string };

/**
 * Pure. Both rules, applied to a message the model just returned.
 *
 * The greeting is REPAIRED rather than rejected — the correct name is known, so there is
 * nothing to decide. An unverified figure is REJECTED, because the correct figure is
 * exactly what we do not have.
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

  const figures = unverifiedQuantities(out, input.itemText);
  if (figures.length > 0) {
    return { ok: false, reason: `unverified figure(s): ${figures.join(", ")}` };
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
  const user = correction
    ? `${userPrompt(input)}\n\nYour previous attempt stated ${correction}, which appears in no source. Rewrite the anchor with NO figure at all.`
    : userPrompt(input);
  const res = await openrouterChat(
    OR_FEATURE.draft,
    {
      model,
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      max_tokens: 400,
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

  // One repair attempt naming the offending figure. A cent buys a correct message; a
  // rejection here would otherwise throw away an item that is genuinely worth sending.
  const second = enforceDraftRules(await callModel(input, first.reason), input);
  if (second.ok) return second.message;
  throw new Error(`tech-radar draft rejected — ${second.reason}`);
}
