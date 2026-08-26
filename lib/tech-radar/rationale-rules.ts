/**
 * Deterministic rules on a proposed axis, enforced at build time.
 *
 * Why code and not the LLM judge: on 2026-08-26, inside ONE batch at temperature 0, the
 * judge killed one "כ-CITO של בנק גדול…" rationale and passed three with the identical
 * opening. A rule an LLM applies four times and enforces once is not a rule. So the
 * prompt asks, this file enforces, and lib/tech-radar/rationale-gate.ts is a third net
 * for the semantic cases no regex can reach.
 *
 * Pure. No prisma, no LLM.
 */

/**
 * A rationale that opens by restating the job title. "כ-CITO של בנק גדול, רחמיל חתום
 * על…" says nothing a peer with the same title at another company would not also have —
 * which is the whole bar. Matches the "כ" prefix form with or without a hyphen.
 *
 * Deliberately narrow: "כי", "כאשר", "כמו" and "כש-" all legitimately open a sentence,
 * so the letter after "כ" must not begin one of those.
 */
/**
 * Conjunctions that legitimately open a Hebrew sentence with the letter כ. Matched as
 * whole words, NOT via `\b`: in JavaScript `\b` is defined on ASCII word characters, so
 * there is no boundary between a Hebrew letter and a following space — a `כמו\b`
 * lookahead silently never matches, and "כמו שקרה כשלאומי השיקה" was flagged as a title
 * restatement because of it.
 */
const HEBREW_CONJUNCTIONS = new Set(["כי", "כאשר", "כמו", "כפי", "כך"]);

export function opensWithTitle(rationale: string): boolean {
  const t = (rationale ?? "").trim();
  // כ-CITO / כ-VP Product — hyphenated, any script after the hyphen.
  if (/^כ-\s*\S/.test(t)) return true;

  const first = t.split(/\s+/)[0] ?? "";
  if (HEBREW_CONJUNCTIONS.has(first)) return false;
  // כש- ("when…") glues a whole clause onto כ and is never a title.
  if (first.startsWith("כש")) return false;

  // כראש / כמנהל / כסמנכ"ל — the כ prefix on a role noun.
  return /^כ[א-ת]{2,}/.test(first);
}

/** Lower-cased, whitespace-collapsed. Hebrew is unaffected by casing. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Every accepted spelling of every researched competitor, flattened.
 *
 * The research is asked for both scripts ("Bank Leumi / בנק לאומי / לאומי") precisely so
 * this check is possible: the brain writes "לאומי" while the research said "Bank Leumi",
 * and a naive membership test would call a real competitor a hallucination.
 */
export function competitorGazetteer(namedCompetitors: string[]): string[] {
  const out = new Set<string>();
  for (const entry of namedCompetitors ?? []) {
    for (const part of String(entry).split(/[/|,]/)) {
      const n = norm(part);
      if (n) out.add(n);
    }
  }
  return [...out];
}

/** Words that never constitute a company name on their own. */
const NAME_STOPWORDS = new Set([
  "ו", "של", "על", "את", "עם", "או", "גם", "כל", "לא", "הוא", "היא", "הם", "הן",
  "the", "and", "or", "of", "in",
]);

/** Prepositions that introduce a list of rivals in Hebrew business prose. */
const RIVAL_LEAD = /(?:מפני|מול|לעומת|כמו|מצד|נגד)\s+([^.;]+)/g;

function candidatesFromEnumeration(rationale: string): string[] {
  const out: string[] = [];
  for (const m of rationale.matchAll(RIVAL_LEAD)) {
    const list = m[1];
    for (const raw of list.split(/,|\sו-|\bו(?=[א-ת])/)) {
      const cleaned = raw.replace(/^[\s\-–ו]+/, "").trim();
      if (!cleaned) continue;
      // A rival mention is at most a few words; longer means the sentence moved on.
      const words = cleaned.split(/\s+/).filter((w) => !NAME_STOPWORDS.has(norm(w)));
      if (words.length === 0 || words.length > 3) continue;
      out.push(words.join(" "));
    }
  }
  return out;
}

/** Capitalised Latin runs: "Pepper", "Poalim Digital", "Bank Leumi". */
function candidatesFromLatin(rationale: string): string[] {
  return [...rationale.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\b/g)].map((m) => m[1]);
}

/**
 * Names that appear in the rationale but not in the employer's researched competitors.
 *
 * Scope, stated honestly: it reads enumerations after a rival preposition ("מפני לאומי,
 * דיסקונט, וראשון לציון") and capitalised Latin runs. It does NOT parse arbitrary Hebrew
 * prose for proper nouns — no regex does. The prompt is the first line; this catches the
 * shape the failure actually took.
 */
export function unknownNames(rationale: string, gazetteer: string[]): string[] {
  const known = (c: string) => {
    const n = norm(c);
    return gazetteer.some((g) => g === n || g.includes(n) || n.includes(g));
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...candidatesFromEnumeration(rationale), ...candidatesFromLatin(rationale)]) {
    if (!c || known(c) || seen.has(norm(c))) continue;
    seen.add(norm(c));
    out.push(c);
  }
  return out;
}

/** "היא לא חתומה על X" / "הוא לא חותם על X" — what the reasoning ruled OUT. */
const DISCLAIM = /(?:לא\s+חתומ[הת]?\s+על|לא\s+חות[םמ]ת?\s+על|אינ[הו]\s+אחראי[תה]?\s+על)\s+([^.,()]+)/g;

export function disclaimedSubjects(reasoning: string): string[] {
  const out: string[] = [];
  for (const m of (reasoning ?? "").matchAll(DISCLAIM)) {
    const subject = m[1].trim();
    if (subject) out.push(subject);
  }
  return out;
}

/**
 * An axis on a subject the SAME response already said is not this person's.
 *
 * Pazit Garfinkel's reasoning said core modernization belongs to the new CTO, and the
 * brain then proposed a core-modernization axis three lines later. The contradiction is
 * inside one call, so catching it costs nothing.
 *
 * Matches on the disclaimed subject's significant words rather than the whole phrase,
 * because the axis rewords it ("מודרניזציית מערכות ליבה" -> "מערכות ליבה חדשות").
 */
export function contradictsReasoning(
  axis: { label: string; rationale: string },
  reasoning: string
): boolean {
  const hay = norm(`${axis.label} ${axis.rationale}`);
  for (const subject of disclaimedSubjects(reasoning)) {
    const words = norm(subject)
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w));
    if (words.length < 2) continue;
    // Any adjacent pair of the disclaimed subject's words appearing together is enough:
    // it is the same subject, reworded.
    for (let i = 0; i < words.length - 1; i += 1) {
      if (hay.includes(`${words[i]} ${words[i + 1]}`)) return true;
    }
  }
  return false;
}
