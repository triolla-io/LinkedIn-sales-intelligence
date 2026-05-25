import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export type HaikuInput = {
  id: string;
  firstName: string;
  company: string | null;
  needsHebrew: boolean;
  needsSize: boolean;
};

export type HaikuOutput = {
  id: string;
  hebrewFirstName: string | null;
  companySizeRange: "1-50" | "51-200" | "201-1000" | "1001-5000" | "5001+" | null;
};

const SIZE_MIDPOINTS: Record<string, number> = {
  "1-50": 25,
  "51-200": 125,
  "201-1000": 600,
  "1001-5000": 3000,
  "5001+": 10000,
};

export function sizeRangeToMidpoint(range: string): number | null {
  return SIZE_MIDPOINTS[range] ?? null;
}

export async function enrichBatch(inputs: HaikuInput[]): Promise<HaikuOutput[]> {
  if (inputs.length === 0) return [];

  const client = getClient();

  const prompt = `You are a data enrichment assistant for a B2B sales tool.

For each contact in the JSON array below, return an output JSON array with:
- id: unchanged
- hebrewFirstName: Hebrew transliteration of the English first name (e.g. "David" → "דוד", "Jonathan" → "יונתן", "Sarah" → "שרה"). Return null if needsHebrew is false.
- companySizeRange: one of "1-50", "51-200", "201-1000", "1001-5000", "5001+" based on your knowledge of the company headcount. Return null if needsSize is false or company is unknown.

Return ONLY valid JSON — an array, no prose, no markdown fences.

Input:
${JSON.stringify(inputs)}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Haiku response was not an array");
    return parsed as HaikuOutput[];
  } catch (err) {
    console.error("Haiku enrichment failed:", (err as Error).message);
    return [];
  }
}
