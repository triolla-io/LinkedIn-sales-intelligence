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
    for (const raw of list.split(/,|\sו-|\s(?:ו?מול|ו?מפני|ו?לעומת|ו?נגד|ו?מצד)\s|\bו(?=[א-ת])/)) {
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

/**
 * A token written entirely in capitals: API, CTO, AI, KYC, ESG.
 *
 * These are technical terms, and a technical term cannot be the failure this rule exists
 * to catch — an INVENTED COMPANY NAME reaching an executive. Treating them as names cost
 * Erez Rachmil three of five axes and Elinor two of five in the 2026-08-26 preview: the
 * CITO, whose entire world is written in acronyms, was the one it silenced hardest.
 *
 * The exemption is deliberately narrow — 2 to 5 capitals and nothing else — so a real
 * name never hides behind it. "IBM" is exempt too; a bank rival called IBM is not the
 * shape of hallucination anyone has seen, and the LLM judge is still the second net.
 */
const ACRONYM = /^[A-Z]{2,5}$/;

/** Capitalised Latin runs: "Pepper", "Poalim Digital", "Bank Leumi". */
function candidatesFromLatin(rationale: string): string[] {
  return [...rationale.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\b/g)].map((m) => m[1]);
}

/**
 * True when a candidate names no company — every word in it is an acronym, a stopword or
 * a Hebrew particle.
 *
 * Applied to BOTH sources, because the same acronym arrives by both roads: the Latin
 * scan reads "API" out of "API-first", and the enumeration scan reads "ה-CTO שלה" out of
 * "מול ה-CTO שלה". A mixed run ("SAP Ariba") still names something and survives.
 */
function namesNothing(candidate: string): boolean {
  const words = candidate
    .split(/\s+/)
    // The definite article and a conjunction glued by a hyphen — "ה-CTO", "ו-API".
    .map((w) => w.replace(/^[הוב-ל]-/u, "").replace(/^[-–]+|[-–]+$/g, ""))
    .filter((w) => w && !NAME_STOPWORDS.has(norm(w)) && !POSSESSIVES.has(norm(w)));
  return words.length === 0 || words.every((w) => ACRONYM.test(w));
}

/** Hebrew possessives that trail a name and are not part of it. */
const POSSESSIVES = new Set(["שלה", "שלו", "שלהם", "שלכם", "שלנו"]);

/**
 * Plural category nouns and generic modifiers. A phrase built only from these DESCRIBES a
 * category; it does not NAME a company.
 *
 * "מפני זרימה לבנקים אחרים" was flagged as an invented rival in the 2026-08-26 preview —
 * every word of it is ordinary Hebrew, and the rival-preposition scan cannot tell a
 * described category from a named company by position alone. The fix belongs here, in what
 * counts as a name, and not in a list of forbidden phrases: the next phrase would differ.
 */
const CATEGORY_WORDS = new Set([
  "בנקים", "חברות", "ספקים", "גופים", "שחקנים", "מתחרים", "מתחרות", "קמעונאים",
  "פינטקים", "מוסדות", "תאגידים", "לקוחות", "שווקים", "פלטפורמות", "זרימה", "יריבים",
  "banks", "companies", "vendors", "players", "competitors", "institutions",
]);
/**
 * Locatives that trail a category noun. "חברות אחרות בשוק" is still a category; the
 * "בשוק" adds a place, not an identity.
 */
const GENERIC_FILLER = new Set([
  "בשוק", "שוק", "בתחום", "תחום", "בענף", "ענף", "בזירה", "במגזר", "מגזר", "בסקטור",
  "market", "sector", "industry", "space",
]);

const GENERIC_MODIFIERS = new Set([
  "אחרים", "אחרות", "אחר", "אחרת", "נוספים", "נוספות", "שונים", "שונות", "זרים", "זרות",
  "מקומיים", "מקומיות", "גדולים", "גדולות", "קטנים", "קטנות", "בינלאומיים", "מובילים",
  "other", "others", "additional", "various", "foreign", "local", "leading",
]);

/**
 * A candidate whose every significant word is a generic category or modifier.
 *
 * Deliberately requires ALL of them to be generic: "בנקים אחרים" names nobody, while
 * "בנקים כמו Revolut" still carries a name that must be checked.
 */
function describesCategory(candidate: string): boolean {
  const words = candidate.split(/\s+/).map(norm).filter(Boolean);
  if (words.length === 0) return false;
  // BOTH forms are tested, never the stripped form alone: "בנקים" begins with ב, which is
  // also the preposition prefix, so stripping it yields "נקים" and the word stops matching.
  // Hebrew prefixes cannot be removed without a lexicon; testing both costs nothing.
  const inAny = (w: string) =>
    CATEGORY_WORDS.has(w) || GENERIC_MODIFIERS.has(w) || GENERIC_FILLER.has(w);
  const generic = (w: string) => inAny(w) || inAny(w.replace(/^[הולבמ]-?/u, ""));
  // At least one CATEGORY word, and nothing that is not generic: "בנקים אחרים" names
  // nobody, while "ראשון לציון" has no category word at all and stays a name candidate.
  const isCategory = (w: string) => CATEGORY_WORDS.has(w) || CATEGORY_WORDS.has(w.replace(/^[הולבמ]-?/u, ""));
  return words.some(isCategory) && words.every(generic);
}

/**
 * What a company name is DOING in a rationale. Only one of the three is a claim the
 * research can contradict.
 *
 *   self     — the employer, or one of its own products.
 *   exemplar — someone to learn from, on a stage=adopt axis.
 *   rival    — "this company competes with us". The only claim namedCompetitors verifies.
 *
 * The 2026-08-26 preview knew only the third role, and lost four axes for it: Gil Tamir's
 * own employer "Phoenix" was called an unknown competitor, so were Bank Hapoalim's own
 * products "Poalim UP" and "Poalim Young" in Pazit Garfinkel's axes, and so were "Grab"
 * and "Gojek" — named in an adopt axis as super-app examples to copy, which is the
 * opposite of a competitive claim. Three of Pazit's five axes died to this, which is the
 * whole reason her profile came back thin.
 */
export type NameRole = "self" | "rival" | "exemplar";

export function nameRole(
  name: string,
  ctx: { employer: { names: string[]; products: string[] }; stage: string }
): NameRole {
  const n = norm(name);
  const mine = [...(ctx.employer.names ?? []), ...(ctx.employer.products ?? [])].map(norm).filter(Boolean);
  // Containment both ways: the research says "Phoenix Holdings" and the brain writes
  // "Phoenix"; it says "Poalim UP" and the brain writes it verbatim.
  if (mine.some((m) => m === n || m.includes(n) || n.includes(m))) return "self";
  // An adopt axis is BY DEFINITION about someone outside the competitive set. Verifying its
  // names against namedCompetitors asks the wrong question and can only ever reject.
  if (ctx.stage === "adopt") return "exemplar";
  return "rival";
}

/**
 * Names CLAIMED AS RIVALS that the employer's research never named.
 *
 * Replaces the role-blind unknownNames for gate use: an invented rival in a message to a
 * board member cannot be taken back, but the employer's own brand and a foreign exemplar
 * are not that failure and must not be punished as it.
 */
export function unverifiedRivals(
  text: string,
  ctx: { employer: { names: string[]; products: string[] }; stage: string; gazetteer: string[] }
): string[] {
  if (ctx.stage === "adopt") return [];
  return unknownNames(text, ctx.gazetteer).filter(
    (n) => !describesCategory(n) && nameRole(n, { employer: ctx.employer, stage: ctx.stage }) === "rival"
  );
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
    if (!c || namesNothing(c) || known(c) || seen.has(norm(c))) continue;
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

// ─── The two declared sides of the crossing ──────────────────────────────────
//
// The 2026-08-26 run produced axes that were UNIONS, not intersections: Erez Rachmil
// (CITO, Bank Hapoalim) got core-systems modernization, real-time payments, open API
// architecture and fraud detection — his EMPLOYER'S axes, identical for any CITO at any
// bank. Nothing in the pipeline could tell, because the two sides of the crossing lived
// only as prose inside one Hebrew sentence, and no regex reads intent out of prose.
//
// So an axis now DECLARES its sides — `personDecision` and `companyFact` — and these two
// rules check the declaration. A rationale that names only one side is an admission that
// no crossing happened, and the same is true of a side declared with a job title or with
// a fact that turns out to be about technology rather than about the company.

/** Final letter forms folded to their base, so a stem can be written once. */
function foldFinals(s: string): string {
  return s.replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ");
}

/**
 * Words, Hebrew-safe.
 *
 * Every "does this text contain word X" test in this file works on split tokens rather
 * than on `\b`, because in JavaScript `\b` is defined on ASCII word characters: there is
 * no boundary between a Hebrew letter and a space, so a `\b`-anchored Hebrew pattern
 * silently never fires (the same trap that once flagged "כמו שקרה כשלאומי השיקה" as a
 * title restatement — see HEBREW_CONJUNCTIONS).
 */
function tokens(s: string): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}&]+/u)
    .filter(Boolean);
}

/** One-letter Hebrew prefixes that glue onto a noun: "בהחלטות", "להחלטת", "ומחזיק". */
const HEB_PREFIX = /^[הובלמשכ]/u;

function startsWithStem(word: string, stem: string): boolean {
  const w = foldFinals(word);
  const s = foldFinals(stem);
  return w.startsWith(s) || (HEB_PREFIX.test(w) && w.slice(1).startsWith(s));
}

/**
 * Wording that claims OWNERSHIP rather than describing a chair.
 *
 * Taken from what the prompt asks for and from what the brain actually wrote in the
 * 2026-08-26 preview ("חתום על", "מחזיקה את החלטת", "אחראית על"). A personDecision made
 * only of role nouns — "ראש בנקאות קמעונאית" — passes no swap test: it is the title, and
 * the title is the side that has to be crossed, not the crossing.
 */
const OWNERSHIP_STEMS = [
  "חתומ", "חות", "מחזיק", "אחראי", "אחריות", "מנהל", "מוביל", "בעל", "החלט",
  "תקציב", "מופקד", "יעד", "p&l", "owns", "signs", "holds",
];

export function declaresPersonSide(personDecision: string): boolean {
  const t = (personDecision ?? "").trim();
  if (!t) return false;
  // A title in this field is the title-restatement failure moved one field over, so the
  // rationale rule is reused rather than restated: "כ-CITO של בנק הפועלים" names the
  // chair, and every CITO of every bank sits in the same one.
  if (opensWithTitle(t)) return false;
  return tokens(t).some((w) => OWNERSHIP_STEMS.some((s) => startsWithStem(w, s)));
}

/**
 * Hebrew words that name WHO a company serves.
 *
 * Why a lexicon and not the employer's own `customerSegments`: research stores that field
 * in ENGLISH ("B2C: Individual consumers and retail customers") while the brain writes
 * the companyFact in HEBREW, so a membership test against the stored segments matches
 * nothing at all — cross-script word matching does not exist, and a translation layer
 * here would be a second paid call to answer what the judge already answers. The stored
 * segments are still honoured when the fact quotes them verbatim (see the third path in
 * declaresCompanySide); this lexicon covers the normal case, in the words Israeli
 * business Hebrew actually uses for a customer base.
 */
const SEGMENT_STEMS = [
  "לקוח", "צרכנ", "מבוטח", "חוסכ", "לוו", "משקיע", "מעסיק", "סוחר", "מנוי",
  "עמית", "גמלא", "פנסיונר", "סטודנט", "קמעונאי", "עסקים", "עסקיים", "משתמש",
  "b2c", "b2b", "b2g", "consumers", "policyholders", "merchants", "smb", "sme",
];

/** Multi-word segment phrases, matched on the normalised string. */
const SEGMENT_PHRASES = ["משקי בית", "עסקים קטנים", "retail customers", "small business"];

function namesSegment(normalised: string, words: string[]): boolean {
  if (SEGMENT_PHRASES.some((p) => normalised.includes(p))) return true;
  return words.some((w) => SEGMENT_STEMS.some((s) => startsWithStem(w, s)));
}

/** The employer's stored segments as matchable words, for a verbatim quote of them. */
function segmentQuoteWords(customerSegments: string[]): string[] {
  const out = new Set<string>();
  for (const seg of customerSegments ?? []) {
    for (const w of tokens(String(seg))) {
      if (w.length > 2 && !NAME_STOPWORDS.has(w)) out.add(w);
    }
  }
  return [...out];
}

/**
 * True when the companyFact actually names something about THE COMPANY: a competitor the
 * research found, or the customer base.
 *
 * Naming a technology is not naming the company — "ארכיטקטורת API פתוחה" is the shape of
 * every axis Erez Rachmil was given, and it is why the ACRONYM exemption in unknownNames
 * must not be read as "an acronym is a company fact". It is neither.
 */
export function declaresCompanySide(
  companyFact: string,
  gazetteer: string[],
  customerSegments: string[] = []
): boolean {
  const t = (companyFact ?? "").trim();
  if (!t) return false;
  const n = norm(t);
  // A rival BY NAME is the strongest company side there is — provided the research
  // actually found it. The gazetteer already spans both scripts of each name.
  if (gazetteer.some((g) => g.length > 1 && n.includes(g))) return true;
  const words = tokens(n);
  if (namesSegment(n, words)) return true;
  return segmentQuoteWords(customerSegments).some((w) => words.includes(w));
}
