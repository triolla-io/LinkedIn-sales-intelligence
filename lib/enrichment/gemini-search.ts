/**
 * Company enrichment via Google Gemini with the built-in Google Search tool.
 *
 * Gemini runs a real Google search, reads the top results, and returns
 * structured JSON. No hallucination because answers are grounded in actual
 * Google search results.
 *
 * Free tier: 1,500 requests/day on Gemini 2.0 Flash.
 * Cost beyond free: ~$0.0001 per call (essentially free at our scale).
 *
 * Setup: get an API key at https://aistudio.google.com/apikey
 * Add to .env as: GEMINI_API_KEY=...
 */
import { GoogleGenAI } from "@google/genai";

export type WebEnrichResult = {
  staffCount: number | null;
  industry: string | null;
  website: string | null;
  description: string | null;
  confidence: "high" | "low" | "none";
};

const PROMPT = (name: string, hint?: string) => `You are a B2B data researcher. Use Google Search to find information about this company.

Company name: "${name}"${hint ? `\nHint: ${hint}` : ""}

Find:
- Approximate current employee count (number)
- Primary industry (short string like "Software Development", "Financial Services", "Cybersecurity", "Motor Vehicle Manufacturing")
- Official website domain
- One-sentence description

If the name is ambiguous, prefer the company whose LinkedIn page or domain matches the name most directly. If you can't find it, return nulls.

Return strict JSON only — no prose, no markdown fences. Exact shape:
{
  "staffCount": number or null,
  "industry": string or null,
  "website": string or null,
  "description": string or null,
  "confidence": "high" | "low" | "none"
}

Use "high" when multiple sources agree. Use "low" when only one weak signal. Use "none" if you couldn't find the company.`;

function tryParseJson(text: string): WebEnrichResult | null {
  // Strip code fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fence ? fence[1] : text;
  try {
    const parsed = JSON.parse(candidate.trim());
    if (typeof parsed !== "object" || parsed === null) return null;
    const staffCount =
      typeof parsed.staffCount === "number" && parsed.staffCount > 0 && parsed.staffCount <= 5_000_000
        ? parsed.staffCount : null;
    return {
      staffCount,
      industry: typeof parsed.industry === "string" ? parsed.industry : null,
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

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) return null;
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

export async function enrichCompanyViaGemini(name: string, hint?: string): Promise<WebEnrichResult> {
  const empty: WebEnrichResult = { staffCount: null, industry: null, website: null, description: null, confidence: "none" };
  const client = getClient();
  if (!client) return empty;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: PROMPT(name, hint),
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text ?? "";
    if (!text) return empty;
    return tryParseJson(text) ?? empty;
  } catch (err) {
    console.error(`Gemini enrich failed for "${name}":`, (err as Error).message);
    return empty;
  }
}
