/**
 * Drafts a short personal Hebrew outreach that opens with a relevant fintech news item.
 * Mirrors lib/company-signals/draft.ts. Missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
export type DraftInput = {
  contactFullName: string;
  hebrewFirstName: string | null;
  contactTitle: string | null;
  articleTitle: string;
  articleSummary: string;
  articleUrl: string;
};

const SYSTEM = `You write short, warm, PERSONAL Hebrew LinkedIn/email openers that share a relevant fintech news item with a senior professional, to start a conversation.

Rules:
- 2-3 sentences, natural spoken Hebrew, warm and human — never generic boilerplate. At most one emoji.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Reference the specific news item concretely and say why it might interest them.
- End with a light, open question that invites a reply. Do NOT hard-pitch or ask for a meeting.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: DraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `News item: ${i.articleTitle}`,
    `Details: ${i.articleSummary}`,
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

export async function draftEngagement(input: DraftInput): Promise<string> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured — refusing to draft engagement message");
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
        messages: [ { role: "system", content: SYSTEM }, { role: "user", content: userPrompt(input) } ],
        temperature: 0.5,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`fintech-radar draft failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const msg = parseDraftJson(text);
    if (!msg) throw new Error("fintech-radar draft returned unparseable output");
    return msg;
  } finally {
    clearTimeout(timeout);
  }
}
