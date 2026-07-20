/**
 * Drafts a short personal Hebrew LinkedIn congratulation for a company event.
 * Mirrors lib/job-check/judge-change.ts. Missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
export type DraftInput = {
  contactFullName: string;
  hebrewFirstName: string | null;
  contactTitle: string | null;
  companyName: string;
  signalType: string;
  signalTitle: string;
  signalSummary: string;
};

const SYSTEM = `You write short, warm, PERSONAL LinkedIn congratulation messages IN HEBREW about a positive event at the recipient's company.

Rules:
- 2-3 sentences, natural spoken Hebrew, warm and human — never generic boilerplate. At most one emoji.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Mention the specific event (the funding / launch / office / award) concretely by what it is.
- Do NOT ask for a meeting or pitch anything — this is a genuine congratulation only.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: DraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Company: ${i.companyName}`,
    `Event type: ${i.signalType}`,
    `Event: ${i.signalTitle}`,
    `Details: ${i.signalSummary}`,
  ].join("\n");
}

export function parseDraftJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    const msg = parsed?.draftMessage;
    return typeof msg === "string" && msg.trim().length > 0 ? msg.trim() : null;
  } catch {
    return null;
  }
}

export async function draftCongrats(input: DraftInput): Promise<string> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured — refusing to draft congratulations");
  }
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
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
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`company-signals draft failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const msg = parseDraftJson(text);
    if (!msg) throw new Error("company-signals draft returned unparseable output");
    return msg;
  } finally {
    clearTimeout(timeout);
  }
}
