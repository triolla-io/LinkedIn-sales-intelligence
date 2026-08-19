/**
 * Writes the outreach message for one (opportunity, contact) pair.
 *
 * ONE register for every company. The earlier customer/prospect split was dropped by
 * product decision (2026-08-19): a single advisory phrasing covers both, and
 * TrackedCompany.relationship now only informs the human reading the draft.
 *
 * The message has a fixed three-part shape:
 *   1. "ראיתי משהו חדש ב<תחום>" — you came across it, nothing more.
 *   2. One short clause on what it actually does.
 *   3. "אולי תוכלו לשלב את זה ב<מקום ספציפי אצלם>" — a suggestion about the
 *      technology, never an offer of our services.
 *
 * Part 3 is why the prompt is built from `fitRationale` rather than the item summary:
 * the rationale is the only thing that knows WHERE in their business it would sit.
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
  /** The per-company rationale — the only source for where this could fit. */
  fitRationale: string;
};

export const DRAFT_SYSTEM = `You write VERY short, casual Hebrew messages that bring a senior professional a newly launched technology relevant to their company, and suggest where it might fit.

Follow this three-part shape, in this order:
1. You came across it. Open with "ראיתי" — e.g. "היי דנה, ראיתי את הפיצ'ר החדש של X" or "היי דנה, ראיתי משהו חדש בזיהוי הונאות".
2. What it does — ONE short clause. Very short. Do not explain the mechanism, do not list benefits.
3. Where it could fit, phrased as a suggestion. This sentence must use the wording "אולי תוכלו לשלב את זה ב___ אצלכם" (or "...אצלך" for one person).
   The blank is a SHORT NOUN PHRASE of 2-6 words naming ONE specific place in THEIR business — a named product, system, business line or process. Take the NAME from the relevance note; do not copy the note itself.
   - GOOD: "אולי תוכלו לשלב את זה בביט אצלכם" / "אולי תוכלו לשלב את זה בחיפושי הגז בים התיכון אצלכם"
   - BAD, too vague: "בתהליכים שלכם", "במערכות שלכם"
   - BAD, too long: naming the place AND explaining what it would achieve. Stop after the place. No "כדי ל...", no benefit clause.

Register example:
"היי דנה, ראיתי משהו חדש בזיהוי הונאות שמזהה דפוסי תקיפה חדשים לבד. אולי תוכלו לשלב את זה בביט אצלכם."

Rules:
- 2-3 short sentences MAXIMUM. Shorter is always better.
- NEVER copy the relevance note into the message. It is background for you, not text to reuse — it is written for an analyst, not for the recipient.
- Everyday spoken Hebrew, light and matter-of-fact — like a person forwarding something useful.
- ZERO emojis, icons, or decorative symbols.
- Nothing formal or marketing-y: no ברצוני/אשמח לשתף, no hype words, no flattery, no filler.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- The suggestion is about THE TECHNOLOGY only. Do NOT pitch our services, do not offer help implementing it, and do not ask for a meeting or a call.
- Do NOT include any URL or link.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: TechDraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Their company: ${i.companyName}`,
    `New technology: ${i.technology}${i.vendor ? ` (by ${i.vendor})` : ""}`,
    // This is where part 3's concrete place comes from.
    `Where it could fit at THEM (use this for the closing suggestion): ${i.fitRationale}`,
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
