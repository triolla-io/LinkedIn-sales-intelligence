import { OpenRouterBlockedError, openrouterChat } from "@/lib/openrouter/client";

export type NameInput = { id: string; firstName: string };
export type NameOutput = { id: string; hebrewFirstName: string | null };

const SYSTEM = `You are a Hebrew transliteration assistant.
Given a JSON array of contacts with English first names, return a JSON array with the Hebrew transliteration of each first name.
Use standard Israeli Hebrew transliteration (e.g. "David"→"דוד", "John"→"ג'ון", "Sarah"→"שרה").
Return ONLY a valid JSON array — no prose, no markdown fences.
Output format: [{"id":"...","hebrewFirstName":"..."}]`;

function tryParse(text: string): NameOutput[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return null;
    return parsed as NameOutput[];
  } catch {
    return null;
  }
}

export async function translateNames(inputs: NameInput[]): Promise<NameOutput[]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return [];

  // Hebrew transliteration quality matters (deepseek produced wrong forms like
  // "Paz"→"פת"), so use a dedicated var defaulting to the same Hebrew-capable
  // model the job-change judge uses — NOT the shared OPENROUTER_MODEL default.
  const model = process.env.NAME_TRANSLATION_MODEL ?? "anthropic/claude-haiku-4.5";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await openrouterChat(
        "hebrew-names",
        {
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: JSON.stringify(inputs) },
          ],
          temperature: 0,
          max_tokens: 1024,
        },
        { timeoutMs: 15_000 }
      );

      if (!res.ok) {
        const is503 = res.status === 503 || res.status === 429;
        if (is503 && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5_000));
          continue;
        }
        console.error(`OpenRouter name translation failed: ${res.status} ${res.detail}`);
        return [];
      }

      const text = (res.data.choices?.[0]?.message?.content ?? "").trim();
      const parsed = tryParse(text);
      if (!parsed) {
        console.error("OpenRouter name translation: unexpected response format");
        return [];
      }
      return parsed;
    } catch (err) {
      const msg = (err as Error).message;
      if (err instanceof OpenRouterBlockedError) {
        // Kill-switch / budget block: retrying won't help and names are best-effort.
        console.error("OpenRouter name translation blocked:", msg);
        return [];
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5_000));
        continue;
      }
      console.error("OpenRouter name translation failed:", msg);
      return [];
    }
  }
  return [];
}
