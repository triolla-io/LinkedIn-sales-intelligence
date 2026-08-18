/**
 * Writes the outreach message for one (opportunity, contact) pair.
 *
 * Two tone variants, selected by the company's relationship. Both inherit the
 * rules already enforced in production (see lib/fintech-radar/draft.ts): very
 * short, spoken Hebrew, zero emojis, nothing marketing-y. The CUSTOMER variant
 * adds exactly one permission — referencing the shared work and suggesting a
 * look together. Neither variant pitches.
 *
 * The prompt is built from `fitRationale`, NOT the generic item summary. That is
 * what makes the message specific to this company instead of a digest of an
 * article. The source link is shown in the UI, never pushed into the body.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE, type CompanyRelationshipTone } from "@/lib/tech-radar/types";

export type TechDraftInput = {
  contactFullName: string;
  hebrewFirstName: string | null;
  contactTitle: string | null;
  companyName: string;
  relationship: CompanyRelationshipTone;
  technology: string;
  vendor: string | null;
  /** The per-company rationale — the whole point of the message. */
  fitRationale: string;
};

const SHARED_RULES = `Rules:
- Sound like a real person sending something interesting to someone they know: everyday spoken Hebrew, light and matter-of-fact.
- 1-2 short sentences total. Shorter is always better.
- ZERO emojis, icons, or decorative symbols.
- Nothing formal, marketing-y, or AI-sounding: no ברצוני/אשמח לשתף, no hype words, no flattery, no filler.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Name the technology concretely but in a few words — never recap it.
- Do NOT include any URL or link.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

const PROSPECT_SYSTEM = `You write VERY short, casual Hebrew messages that bring a senior professional a new technology relevant to what their company does, to start a conversation.

Register example: "היי דנה, נתקלתי במשהו חדש בזיהוי הונאות שממש התחבר לי למה שאתם עושים בכרטיסים. חשבתי שיעניין אותך."

- Do NOT pitch anything, do NOT offer help, and do NOT ask for a meeting or a call. You are simply someone who saw something relevant.
- A short open question at the end is optional, only if it feels natural.

${SHARED_RULES}`;

const CUSTOMER_SYSTEM = `You write VERY short, casual Hebrew messages to a senior professional at a company you ALREADY work with, bringing them a new technology relevant to what they do.

Register example: "היי דנה, יצא משהו חדש בזיהוי הונאות. מתחבר לכיוון שדיברנו עליו, שווה שנסתכל."

- You may reference the shared work and suggest looking at it together ("שווה שנסתכל", "מתחבר למה שעשינו").
- Still do NOT pitch, do NOT sell, and do NOT ask for a formal meeting. It is a colleague's note, not an offer.

${SHARED_RULES}`;

export function systemPromptFor(relationship: CompanyRelationshipTone): string {
  return relationship === "CUSTOMER" ? CUSTOMER_SYSTEM : PROSPECT_SYSTEM;
}

function userPrompt(i: TechDraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Their company: ${i.companyName}`,
    `New technology: ${i.technology}${i.vendor ? ` (by ${i.vendor})` : ""}`,
    `Why it is relevant to THEM: ${i.fitRationale}`,
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
        { role: "system", content: systemPromptFor(input.relationship) },
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
