/**
 * Drafts short, dry, human Hebrew congratulation variants (LinkedIn / WhatsApp / email)
 * for a company event. Mirrors lib/job-check/judge-change.ts. Missing OPENROUTER_API_KEY
 * THROWS (never guess).
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
  eventDate: string | null; // YYYY-MM-DD when known
  today: string; // YYYY-MM-DD
};

export type DraftVariants = {
  linkedin: string;
  whatsapp: string;
  emailSubject: string;
  emailBody: string;
};

const SYSTEM = `You write VERY short congratulation messages IN HEBREW from one businessperson to another, about a positive event at the recipient's company. Produce three variants: a LinkedIn DM, a WhatsApp message, and a short email.

Tone — the most important part:
- Sound like a real person typing quickly to a colleague. Dry, friendly, matter-of-fact. Register example: "היי דנה, נתקלתי בידיעה על הגיוס. סחטיין, בהצלחה בהמשך."
- 1-2 short sentences for LinkedIn and WhatsApp. Email body: at most 2 short sentences plus a greeting line.
- ZERO emojis, icons, or decorative symbols. At most one exclamation mark across all variants.
- No hype words (מרגש, מדהים, פנטסטי, גאים) and no marketing phrasing.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Mention the specific event concretely (the funding / launch / office / award — with the concrete detail, e.g. the amount).
- Date awareness: you are given today's date and the event date. If the event is more than ~10 days old, acknowledge the timing naturally (e.g. "ראיתי שלפני כמה שבועות..."). NEVER present old news as fresh and NEVER invent a date.
- Do NOT ask for a meeting or pitch anything — a genuine congratulation only.
- emailSubject: 3-6 words, same dry tone (e.g. "סחטיין על הגיוס"). emailBody: open with "היי <שם>," on its own line, then the message; no signature block.

Return strict JSON only — no prose, no markdown fences:
{"linkedin": string, "whatsapp": string, "emailSubject": string, "emailBody": string}`;

function userPrompt(i: DraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Company: ${i.companyName}`,
    `Event type: ${i.signalType}`,
    `Event: ${i.signalTitle}`,
    `Details: ${i.signalSummary}`,
    `Event date: ${i.eventDate ?? "unknown"}`,
    `Today: ${i.today}`,
  ].join("\n");
}

const VARIANT_KEYS = ["linkedin", "whatsapp", "emailSubject", "emailBody"] as const;

export function parseDraftVariants(text: string): DraftVariants | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const out: Partial<Record<(typeof VARIANT_KEYS)[number], string>> = {};
    for (const key of VARIANT_KEYS) {
      const v = parsed?.[key];
      if (typeof v !== "string" || v.trim().length === 0) return null;
      out[key] = v.trim();
    }
    return out as DraftVariants;
  } catch {
    return null;
  }
}

export async function draftCongrats(input: DraftInput): Promise<DraftVariants> {
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
        max_tokens: 700,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`company-signals draft failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const variants = parseDraftVariants(text);
    if (!variants) throw new Error("company-signals draft returned unparseable output");
    return variants;
  } finally {
    clearTimeout(timeout);
  }
}
