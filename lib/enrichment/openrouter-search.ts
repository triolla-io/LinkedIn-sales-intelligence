/**
 * Company enrichment via OpenRouter (cheap LLM, training-data based).
 *
 * Uses the OpenAI-compatible API. Model is configurable via OPENROUTER_MODEL env var.
 * Default: deepseek/deepseek-chat (~$0.14 / 1M tokens — essentially free at our scale).
 *
 * Setup: get an API key at https://openrouter.ai/keys
 * Add to .env:
 *   OPENROUTER_API_KEY=sk-or-...
 *   OPENROUTER_MODEL=deepseek/deepseek-chat   (optional, this is the default)
 */

export type WebEnrichResult = {
  staffCount: number | null;
  industry: string | null;
  vertical: string | null;
  website: string | null;
  description: string | null;
  confidence: "high" | "low" | "none";
};

const SYSTEM = `You are a B2B data researcher with broad knowledge of companies worldwide.
Given a company name, return what you know about it.
Return strict JSON only — no prose, no markdown fences. Exact shape:
{
  "staffCount": number or null,
  "industry": string or null,
  "vertical": string or null,
  "website": string or null,
  "description": string or null,
  "confidence": "high" | "low" | "none"
}
Use "high" when you're confident, "low" when uncertain, "none" if you don't recognise the company.
staffCount must be a realistic integer (e.g. 4500) or null.
industry should be a short English string like "Cybersecurity", "Financial Services", "Recruiting".
vertical should be a single broad market vertical in English: one of "Cybersecurity", "Fintech", "Healthcare", "Gaming", "E-commerce", "SaaS", "Media", "Real Estate", "Legal", "Education", "Manufacturing", "Logistics", "HR Tech", "Marketing Tech", "Dev Tools", or another concise label if none fit. Return null if unknown.`;

const USER = (name: string) =>
  `Company name: "${name}"\n\nFill in staffCount, industry, website, description, confidence.`;

function tryParseJson(text: string): WebEnrichResult | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null) return null;
    const staffCount =
      typeof parsed.staffCount === "number" && parsed.staffCount > 0 && parsed.staffCount <= 5_000_000
        ? Math.round(parsed.staffCount) : null;
    return {
      staffCount,
      industry: typeof parsed.industry === "string" ? parsed.industry : null,
      vertical: typeof parsed.vertical === "string" ? parsed.vertical.slice(0, 100) : null,
      website: typeof parsed.website === "string" ? parsed.website : null,
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 500) : null,
      confidence:
        parsed.confidence === "high" || parsed.confidence === "low" || parsed.confidence === "none"
          ? parsed.confidence : "low",
    };
  } catch {
    return null;
  }
}

export function isOpenRouterConfigured(): boolean {
  return (process.env.OPENROUTER_API_KEY ?? "").trim().length > 0;
}

export async function enrichCompanyViaOpenRouter(name: string): Promise<WebEnrichResult> {
  const empty: WebEnrichResult = { staffCount: null, industry: null, vertical: null, website: null, description: null, confidence: "none" };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return empty;

  const model = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER(name) },
        ],
        temperature: 0,
        max_tokens: 320,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`OpenRouter enrich failed for "${name}": ${res.status}`);
      return empty;
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return tryParseJson(text) ?? empty;
  } catch (err) {
    console.error(`OpenRouter enrich error for "${name}":`, (err as Error).message);
    return empty;
  }
}
