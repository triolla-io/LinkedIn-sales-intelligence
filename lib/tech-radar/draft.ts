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
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Reproduce the link EXACTLY as given, once, as the last line. Never invent, shorten or alter a URL. If no link is provided, end after the sentence and include no URL at all.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: TechDraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Their company: ${i.companyName}`,
    `The item: ${i.technology}${i.vendor ? ` (by ${i.vendor})` : ""}`,
    // Background for part 2's concrete anchor — never for quoting.
    `Why it touches THEM (background — take only the name of the thing, never the wording): ${i.fitRationale}`,
    i.sourceUrl
      ? `Link (reproduce verbatim as the last line): ${i.sourceUrl}`
      : `Link: none available — do not include any URL.`,
  ].join("\n");
}

export function parseDraftJson(text: string): string | null {
  const parsed = parseJsonLoose<{ draftMessage?: unknown }>(text);
  const msg = parsed?.draftMessage;
  return typeof msg === "string" && msg.trim().length > 0 ? msg.trim() : null;
}

export async function draftTechMessage(input: TechDraftInput): Promise<string> {
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.draft,
    {
      model,
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: userPrompt(input) },
      ],
      temperature: 0.5,
      max_tokens: 400,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 20_000 }
  );
  if (!res.ok) throw new Error(`tech-radar draft failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  const msg = parseDraftJson(text);
  if (!msg) throw new Error("tech-radar draft returned unparseable output");
  return msg;
}
