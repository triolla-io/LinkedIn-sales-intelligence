import { GoogleGenAI } from "@google/genai";

export type NameInput = { id: string; firstName: string };
export type NameOutput = { id: string; hebrewFirstName: string | null };

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (_client) return _client;
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) return null;
  _client = new GoogleGenAI({ apiKey: key });
  return _client;
}

export async function translateNames(inputs: NameInput[]): Promise<NameOutput[]> {
  if (inputs.length === 0) return [];

  const client = getClient();
  if (!client) return [];

  const prompt = `You are a Hebrew transliteration assistant.

For each contact below, return a JSON array with the Hebrew transliteration of their English first name.
Use standard Israeli Hebrew transliteration (e.g. "David"→"דוד", "John"→"ג'ון", "Sarah"→"שרה").

Return ONLY a valid JSON array — no prose, no markdown fences.

Input:
${JSON.stringify(inputs)}

Output format: [{"id":"...","hebrewFirstName":"..."}]`;

  try {
    const response = await client.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const text = (response.text ?? "").trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const candidate = fence ? fence[1] : text;
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
    return parsed as NameOutput[];
  } catch (err) {
    console.error("Gemini name translation failed:", (err as Error).message);
    return [];
  }
}
