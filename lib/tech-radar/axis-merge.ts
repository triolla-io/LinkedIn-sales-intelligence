/**
 * Decide which proposed subjects are the SAME subject as one already in the catalog.
 *
 * One batched call per profile build, not one per pair. This is the level the spec put
 * a model at, and skipping it is what produced 33 axes for 6 people with one subscriber
 * each — per-person fit wearing a costume, and none of the cost sharing that justified
 * axes in the first place.
 *
 * Lexical matching cannot do this job. Two labels for one subject routinely share almost
 * no exact tokens, and Hebrew inflection is invisible without a lexicon. See ASK_ABOVE
 * in lib/tech-radar/axis.ts for the measured evidence.
 */
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose } from "@/lib/tech-radar/parse";
import { OR_FEATURE } from "@/lib/tech-radar/types";

const MODEL = process.env.TECH_RADAR_MODEL ?? "anthropic/claude-haiku-4.5";

export const MERGE_SYSTEM = `You are deduplicating a catalog of interest subjects.

You get a list of EXISTING subjects, each with an id, and a list of NEW proposed subjects. For each new subject, decide whether it is THE SAME SUBJECT as one of the existing ones.

Same subject means a person following one would consider the other the same thing, differently worded. Inflection, word order, and one label being more specific than the other do not make them different subjects.

Examples of THE SAME subject:
- "עיכוב בהעברת נתונים חיים בספורט" and "עיבוד נתונים בזמן אמת בקנה מידה ענק" — both are live data pipeline latency and throughput.
- "מרווחי זיקוק" and "מרווחי זיקוק וגורמי התמחור".

Examples of DIFFERENT subjects:
- "זיהוי הונאות" and "ליבה בנקאית" — both banking, different concerns.
- "נגישות בממשקי משתמש" and "עקביות מערכות עיצוב" — both design, different problems.

Being in the same industry, or both mattering to the same job, does NOT make two subjects the same. When two subjects would return different articles, they are different.

Prefer merging when they would return the SAME articles. Prefer separating when they would not. If you genuinely cannot tell, answer null — a near-duplicate axis costs a little waste, and a wrong merge destroys a distinction that cannot be recovered.

Return strict JSON only — no prose, no fences. Include EVERY new subject exactly once, keyed by its index:
{"answers":[{"index":0,"sameAsId":"ax_123"},{"index":1,"sameAsId":null}]}`;

export type MergeQuestion = { label: string };
export type ExistingAxis = { id: string; label: string };

function userPrompt(existing: ExistingAxis[], questions: MergeQuestion[]): string {
  return [
    "EXISTING subjects:",
    ...existing.map((e) => `- id=${e.id} :: ${e.label}`),
    "",
    "NEW proposed subjects:",
    ...questions.map((q, n) => `${n}. ${q.label}`),
  ].join("\n");
}

/**
 * Pure. Returns index -> existing axis id, or index -> null for "new subject".
 *
 * An id the model invented is dropped rather than trusted: a hallucinated merge target
 * would attach a person to an axis that does not exist, and the failure would surface
 * far from here.
 */
export function parseMergeAnswers(text: string, validIds: Set<string>): Map<number, string | null> {
  const parsed = parseJsonLoose<{ answers?: unknown }>(text);
  const rows = Array.isArray(parsed?.answers) ? parsed.answers : [];
  const out = new Map<number, string | null>();

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const index = typeof o.index === "number" && Number.isInteger(o.index) ? o.index : null;
    if (index === null || index < 0 || out.has(index)) continue;
    const id = typeof o.sameAsId === "string" ? o.sameAsId.trim() : "";
    out.set(index, id && validIds.has(id) ? id : null);
  }
  return out;
}

/**
 * A failed or unparseable call answers null for everything — every proposal becomes a
 * new axis. That is the safe direction: a duplicate axis wastes some search budget, a
 * wrong merge silently folds two subjects together and the rationale that justified the
 * merge is gone.
 */
export async function resolveMergeQuestions(
  existing: ExistingAxis[],
  questions: MergeQuestion[]
): Promise<Map<number, string | null>> {
  if (questions.length === 0 || existing.length === 0) return new Map();

  const res = await openrouterChat(
    OR_FEATURE.axisMerge,
    {
      model: MODEL,
      messages: [
        { role: "system", content: MERGE_SYSTEM },
        { role: "user", content: userPrompt(existing, questions) },
      ],
      temperature: 0.1,
      // ~40 tokens a verdict, plus headroom. A truncated answer loses the whole batch.
      max_tokens: 300 + questions.length * 60,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 30_000 }
  );
  if (!res.ok) return new Map();
  return parseMergeAnswers(
    res.data.choices?.[0]?.message?.content ?? "",
    new Set(existing.map((e) => e.id))
  );
}
