/**
 * LLM judge for job-change candidates that survive deterministic normalization
 * (compare.ts). One call both judges "same company/title, just named differently?"
 * and, for real changes, drafts a personal Hebrew congratulation.
 *
 * Uses OpenRouter (same pattern as lib/enrichment/openrouter-search.ts).
 * Env:
 *   OPENROUTER_API_KEY — required; a missing key THROWS rather than guessing,
 *                        because guessing re-creates the false-positive problem.
 *   JOB_CHECK_MODEL    — optional, default anthropic/claude-haiku-4.5
 *                        (Hebrew drafting quality matters here).
 */

export type JudgeChangeInput = {
  fullName: string;
  hebrewFirstName: string | null;
  prevTitle: string | null;
  newTitle: string | null;
  prevCompany: string | null;
  newCompany: string | null;
};

export type JudgeChangeResult = {
  changeType: "company_move" | "promotion" | "title_change" | "none";
  draftMessage: string | null;
};

const CHANGE_TYPES = ["company_move", "promotion", "title_change", "none"] as const;

const SYSTEM = `You judge whether a LinkedIn contact really changed jobs, comparing an old snapshot to fresh data.

Company names often vary without the company changing: casing (AQUATIS vs Aquatis), legal name vs brand name (Egged Israel Transport Cooperative Society Ltd vs Egged Transportation Company Ltd), Hebrew vs English forms, abbreviations. Titles too (CEO vs Chief Executive Officer, VP R&D vs VP Research & Development).

Decide changeType:
- "none" — company and title are both merely naming variants of the same thing.
- "company_move" — the person moved to a genuinely different company.
- "promotion" — same company, and the title clearly advanced in seniority.
- "title_change" — same company, title changed laterally or advancement is unclear.

If changeType is not "none", write draftMessage: a short, personal LinkedIn congratulation IN HEBREW (2-3 sentences). Mention the new company or the new role BY NAME. Warm and human — never generic boilerplate, at most one emoji. Address the person by their Hebrew first name if provided, otherwise their first name.

Return strict JSON only — no prose, no markdown fences:
{"changeType": "company_move" | "promotion" | "title_change" | "none", "draftMessage": string or null}`;

function userPrompt(input: JudgeChangeInput): string {
  const hebrew = input.hebrewFirstName ? ` (Hebrew first name: ${input.hebrewFirstName})` : "";
  return [
    `Contact: ${input.fullName}${hebrew}`,
    `Previous title: ${input.prevTitle ?? "unknown"}`,
    `Fresh title: ${input.newTitle ?? "unknown"}`,
    `Previous company: ${input.prevCompany ?? "unknown"}`,
    `Fresh company: ${input.newCompany ?? "unknown"}`,
  ].join("\n");
}

export function parseJudgeJson(text: string): JudgeChangeResult | null {
  // Strip markdown fences: defensive against model non-compliance with SYSTEM's "no markdown fences" instruction.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!CHANGE_TYPES.includes(parsed.changeType)) return null;
    if (parsed.changeType === "none") return { changeType: "none", draftMessage: null };
    const draftMessage =
      typeof parsed.draftMessage === "string" && parsed.draftMessage.trim().length > 0
        ? parsed.draftMessage.trim()
        : null;
    if (!draftMessage) return null; // a real change must carry a draft
    return { changeType: parsed.changeType, draftMessage };
  } catch {
    return null;
  }
}

export async function judgeJobChange(input: JudgeChangeInput): Promise<JudgeChangeResult> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured — refusing to judge job changes");
  }
  const model = process.env.JOB_CHECK_MODEL ?? "anthropic/claude-haiku-4.5";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(input) },
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`job-check judge failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJudgeJson(text);
    if (!parsed) throw new Error("job-check judge returned unparseable output");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}
