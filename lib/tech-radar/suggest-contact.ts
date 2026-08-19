/**
 * Who the rep should be talking to, when they have nobody senior at the company.
 *
 * "אין למי לפנות" on its own is a dead end. The same information framed as "this should
 * go to whoever owns X — you don't have them yet" turns the gap into the next action,
 * which is what a prospecting tool is for.
 *
 * Only called when the candidate list is genuinely empty, so it costs nothing on the
 * normal path.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE, type TechRadarProfile } from "@/lib/tech-radar/types";

const SYSTEM = `A sales rep found a newly launched technology relevant to a company, but has no senior contact there to send it to. Say who they should be talking to.

Name the ROLE, not a person — you have no way to know who currently holds it. Pick the one role most likely to own this specific decision at a company of this kind, and prefer the title as it would actually appear on a profile at an Israeli company.

One short sentence in HEBREW, naming the role and why it is that role. No emojis. Do not suggest more than two roles.

Good: "שווה להגיע לסמנכ״ל התשלומים או למי שמחזיק את הסיכון בכרטיסים — הם אלה שיחליטו על מערכת זיהוי הונאות."
Bad, too vague: "שווה להגיע להנהלה הבכירה."

Return strict JSON only — no prose, no fences:
{"suggestion": string}`;

export type SuggestContactInput = {
  companyName: string;
  profile: TechRadarProfile;
  technology: string;
  vendor: string | null;
  fitRationale: string;
};

export function parseSuggestion(text: string): string | null {
  const parsed = parseJsonLoose<{ suggestion?: unknown }>(text);
  const s = parsed?.suggestion;
  return typeof s === "string" && s.trim().length > 0 ? s.trim() : null;
}

/** Returns null rather than throwing: a missing recommendation must not fail a scan. */
export async function suggestContactRole(input: SuggestContactInput): Promise<string | null> {
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  try {
    const res = await openrouterChat(
      OR_FEATURE.suggestContact,
      {
        model,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              `Company: ${input.companyName}`,
              `Business lines: ${(input.profile.businessLines ?? []).map((b) => b.name).join(", ") || "n/a"}`,
              `Products: ${(input.profile.products ?? []).join(", ") || "n/a"}`,
              `Technology: ${input.technology}${input.vendor ? ` (by ${input.vendor})` : ""}`,
              `Why it fits them: ${input.fitRationale}`,
            ].join("\n"),
          },
        ],
        temperature: 0.3,
        max_tokens: 250,
        response_format: { type: "json_object" },
      },
      { timeoutMs: 20_000 }
    );
    if (!res.ok) return null;
    return parseSuggestion(res.data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}
