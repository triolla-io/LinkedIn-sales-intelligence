/**
 * Floor 0 and floor 1 of the matching pyramid: everything that decides relevance BEFORE
 * an LLM is asked anything.
 *
 * The failure this module exists to end, measured in prod on 2026-08-31: a feature story
 * about a retail bank in the PHILIPPINES was offered to Pazit Garfinkel, Head of Retail
 * Banking at Bank Hapoalim. Nothing anywhere in the pipeline ever asked whether an item
 * was in her market. `israelRelevant` had been reporting the shortfall for weeks — it
 * filtered nothing, it only counted. Her `scope.notOwns` names capital markets and
 * corporate banking, and a capital-markets story was still triaged, tagged, judged and
 * vetoed — four paid stages — to reach the same no that one string comparison reaches here.
 *
 * So the order is: cheap and certain first.
 *   `prefilter`   — floor 0, BEFORE triage. Industry pack, notOwns, geography-vs-audience.
 *                   It therefore may not read a single triage field (stature, kind,
 *                   israelRelevant, industryTags): none of them exist yet.
 *   `entityHit` / `tagOverlap` / `passesFloors` — floor 1, AFTER triage, still zero LLM.
 *
 * Every threshold reads from env at CALL time with the default in code, so the bar can be
 * calibrated on the saved drop-outs without a deploy.
 *
 * PURE. No prisma, no LLM, no network.
 */
import { normalizeAxisKey } from "@/lib/tech-radar/axis";
import { isIsraeliSource } from "@/lib/tech-radar/acceptance";
import { INDUSTRY_ONLY_STATURE_FLOOR } from "@/lib/tech-radar/layers";
import type { PersonAudience, PersonScope } from "@/lib/tech-radar/person-profile";

/**
 * An item as the floors see it. Structural on purpose — `sources.ts` does not exist yet
 * and this file must not wait for it.
 *
 * `industryTags` is the closed-taxonomy output of triage, so it is absent at floor 0 and
 * `prefilter` never reads it. Keeping one item type for both floors is deliberate: two
 * types would let a floor-0 rule quietly start reading a floor-1 field.
 */
export type FloorItem = {
  title: string;
  summary?: string;
  /** The article's own URL. Used only for `isIsraeliSource` — the domestic-market marker. */
  url?: string | null;
  /** Which industry pack this item was pulled for. Null for the narrow named-query channel. */
  industryKey?: string | null;
  /** Closed-taxonomy tags, from triage. Floor 1 only. */
  industryTags?: string[];
};

export type FloorPerson = {
  /** The industry pack key of this person's employer. Null = unknown, never a mismatch. */
  industryKey?: string | null;
  /** PersonProfile.audience. Null for a legacy profile built before v3 required it. */
  audience?: PersonAudience | null;
  /** PersonProfile.scope. Null or empty is a weaker filter, not a wrong person. */
  scope?: PersonScope | null;
  /**
   * Names whose moves travel into this person's market whatever country they happen in —
   * the "שחקן גלובלי" road out of the geography gate. Supplied by the caller off the
   * industry pack rather than hard-coded here: who counts as a global player is an
   * industry fact (JPMorgan for a banker, Zara for a retailer), and this file has no
   * industry.
   */
  globalPlayers?: string[];
};

export type PrefilterVerdict = {
  pass: boolean;
  /** A STABLE code, so drop-out rows stay countable across releases. */
  reason?: "industry_mismatch" | "not_owned" | "foreign_local";
  /** Which line, or which foreign market. The half a human needs to judge the rule. */
  detail?: string;
};

// ─── Text, Hebrew-safely ─────────────────────────────────────────────────────
//
// Every "does this text contain X" test here works on SPLIT TOKENS rather than on `\b`,
// for the reason rationale-rules.ts documents at length: in JavaScript `\b` is defined on
// ASCII word characters, so there is no boundary between a Hebrew letter and a space and a
// `\b`-anchored Hebrew pattern silently never fires. Substring matching is the other trap
// — "לאומי" is a substring of "בינלאומי", which is exactly why invalidEntityTags matches
// competitors exactly. Tokens avoid both.

function norm(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function tokens(s: unknown): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Final letter forms folded to their base, so a stem can be written once. */
function foldFinals(s: string): string {
  return s.replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ").replace(/ף/g, "פ").replace(/ץ/g, "צ");
}

/** One-letter Hebrew prefixes that glue onto a noun: "בלאומי", "ההון", "ולאומי". */
const HEB_PREFIX = /^[הובלמשכ]/u;

/**
 * The word with a single Hebrew prefix removed, or the word itself.
 *
 * ONE letter, never more, and only ever tried alongside the unstripped form. Stripping
 * greedily is how "בינלאומי" would become "לאומי" and the invented "בנק בינלאומי ראשון"
 * would read as the researched Bank Leumi — the FIBI case that cost a real query.
 */
function unprefixed(word: string): string {
  return HEB_PREFIX.test(word) ? word.slice(1) : word;
}

/** A text token that IS this form's word — exact, or exact after one Hebrew prefix. */
function wordIs(textToken: string, formToken: string): boolean {
  const t = foldFinals(textToken);
  const f = foldFinals(formToken);
  return t === f || unprefixed(t) === f;
}

/**
 * Shortest stem allowed to match by prefix. Below three characters a Hebrew stem matches
 * most of the language: "הון" is the shortest word any of this has to reach.
 */
const MIN_STEM_CHARS = 3;

/**
 * A text token that is an INFLECTION of this line's word.
 *
 * Deliberately looser than `wordIs`, and only ever used on `scope.notOwns`. Her profile
 * wrote "שוקי הון" and the press writes "שוק ההון"; Hebrew inflection is invisible to
 * token equality and cannot be stripped without a lexicon (an attempt in axis.ts turned
 * "ליבה בנקאית" into "יבה נקאי"). So the match is a bidirectional prefix at three
 * characters or more — and the direction of the resulting error is the safe one here:
 * notOwns exists to DROP items, a false drop costs one article, and a false keep costs a
 * capital-markets story reaching a retail banker.
 */
function wordInflects(textToken: string, lineToken: string): boolean {
  const t = foldFinals(textToken);
  const f = foldFinals(lineToken);
  for (const candidate of [t, unprefixed(t)]) {
    if (candidate.length < MIN_STEM_CHARS || f.length < MIN_STEM_CHARS) {
      if (candidate === f) return true;
      continue;
    }
    if (candidate.startsWith(f) || f.startsWith(candidate)) return true;
  }
  return false;
}

/**
 * Does this multi-word form appear as an ADJACENT run of tokens?
 *
 * Adjacency is the whole test for a multi-word name: "Zero fees at One Bank" contains both
 * words of "One Zero" and is about neither.
 */
function containsRun(
  textTokens: string[],
  formTokens: string[],
  matches: (textToken: string, formToken: string) => boolean
): boolean {
  if (formTokens.length === 0) return false;
  for (let i = 0; i + formTokens.length <= textTokens.length; i += 1) {
    let ok = true;
    for (let k = 0; k < formTokens.length; k += 1) {
      if (!matches(textTokens[i + k], formTokens[k])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * The item's text as separate token streams, one per field.
 *
 * Separate, not concatenated: joining title and summary would create an adjacency across
 * the seam, and a title ending "…One" beside a summary opening "Zero…" would read as an
 * entity hit on One Zero.
 */
function itemTokenStreams(item: FloorItem): string[][] {
  return [tokens(item.title), tokens(item.summary)].filter((s) => s.length > 0);
}

function containsFormAnywhere(
  item: FloorItem,
  formTokens: string[],
  matches: (t: string, f: string) => boolean
): boolean {
  return itemTokenStreams(item).some((stream) => containsRun(stream, formTokens, matches));
}

// ─── Floor 0, check 1: the industry pack ─────────────────────────────────────

/**
 * An item pulled for the banking pack is not measured against the person from H&M.
 *
 * Compared through `normalizeAxisKey`, which token-sorts: a pack whose key was written
 * "בנקאות ישראל" in one place and "ישראל בנקאות" in another is ONE pack, and a mismatch
 * on word order would silently empty every person's candidate list — the failure shape
 * this codebase has hit repeatedly and now reports rather than swallows.
 *
 * Either side missing is NOT a mismatch. The narrow named-query channel carries no pack,
 * and a person whose employer's industry has no pack yet must be reported by the pack
 * resolver (Task 3), not quietly starved here.
 */
function industryMismatch(item: FloorItem, person: FloorPerson): boolean {
  const a = normalizeAxisKey(item.industryKey ?? "");
  const b = normalizeAxisKey(person.industryKey ?? "");
  if (!a || !b) return false;
  return a !== b;
}

// ─── Floor 0, check 2: scope.notOwns ─────────────────────────────────────────

/** Particles and generic nouns that cannot carry a business line on their own. */
const LINE_STOPWORDS = new Set([
  "של", "על", "את", "עם", "או", "גם", "ו", "ה",
  "the", "and", "or", "of", "in", "for", "a",
]);

/**
 * The line's significant words. A line that reduces to nothing contributes nothing —
 * better than a one-particle line matching every article in the pack.
 */
function lineTokens(line: string): string[] {
  return tokens(line).filter((w) => w.length > 1 && !LINE_STOPWORDS.has(w));
}

/**
 * The first `notOwns` line this item is about, or null.
 *
 * This is the check the whole "floors before LLMs" ordering is for. A single-word line
 * needs three characters before it may match — a two-letter line ("IT") would otherwise
 * catch acronym noise across the entire pack.
 */
function notOwnedLine(item: FloorItem, scope: PersonScope | null | undefined): string | null {
  for (const line of scope?.notOwns ?? []) {
    const words = lineTokens(String(line ?? ""));
    if (words.length === 0) continue;
    if (words.length === 1 && words[0].length < MIN_STEM_CHARS) continue;
    if (containsFormAnywhere(item, words, wordInflects)) return String(line);
  }
  return null;
}

// ─── Floor 0, check 3: geography against the audience ────────────────────────

/**
 * The home market of an audience, or null when there is no lexicon for it.
 *
 * Israel only, and null for everything else rather than a guess. `audience.geography` is
 * allowed to be empty by design — a CITO's internal audience has no country, and
 * defaulting it to "ישראל" would manufacture exactly the claim this filter then trusts.
 * A market with no lexicon SKIPS the check, which loses precision and never invents a
 * verdict; the caller reports it (the pack resolver's discipline, one floor over).
 */
export function homeMarket(audience: PersonAudience | null | undefined): "il" | null {
  const g = norm(audience?.geography);
  if (!g) return null;
  if (/ישראל|israel|\bil\b/.test(g)) return "il";
  return null;
}

/** Words and hosts that say this item is ABOUT the home market. */
const DOMESTIC_FORMS: Record<"il", string[]> = {
  il: ["ישראל", "ישראלי", "ישראלית", "ישראליים", "israel", "israeli", "בנק ישראל", "שקל", "shekel", "תל אביב", "tel aviv"],
};

/**
 * Deliberately NOT "the text contains Hebrew letters".
 *
 * A Hebrew write-up of a Philippine bank's new feature is precisely the item that reached
 * Pazit, and script is not market: Globes covers Manila. The markers are the country
 * itself, its currency, its central bank, and an Israeli publisher's host.
 */
function isDomestic(item: FloorItem, market: "il"): boolean {
  if (isIsraeliSource(item.url ?? null)) return true;
  return DOMESTIC_FORMS[market].some((form) => containsFormAnywhere(item, tokens(form), wordIs));
}

/**
 * Foreign markets whose LOCAL story does not travel.
 *
 * Scope, stated honestly: this is a cheap pattern, not a geography engine. It lists the
 * markets whose local retail-banking news demonstrably does not reach an Israeli
 * executive's desk — the Philippines above all, and the Greek and Indian stories the
 * 2026-08-26 run actually returned. It deliberately does NOT list the United States, the
 * United Kingdom or Western Europe: what JPMorgan and the FCA do IS the reference every
 * Israeli banker already reads, and blocking those would cost far more recall than the
 * Philippines costs noise. A market absent from this list is not blocked, which is the
 * conservative direction for a filter that runs before anything can second-guess it.
 */
const FOREIGN_MARKET_FORMS: string[] = [
  "philippines", "philippine", "filipino", "פיליפינים", "הפיליפינים",
  "india", "indian", "הודו", "הודי", "הודית",
  "indonesia", "indonesian", "אינדונזיה",
  "vietnam", "vietnamese", "ויאטנם",
  "thailand", "thai", "תאילנד",
  "malaysia", "malaysian", "מלזיה",
  "singapore", "singaporean", "סינגפור",
  "china", "chinese", "סין", "סינית",
  "japan", "japanese", "יפן",
  "korea", "korean", "קוריאה",
  "taiwan", "טייוואן",
  "pakistan", "pakistani", "פקיסטן",
  "bangladesh", "בנגלדש",
  "sri lanka", "סרי לנקה",
  "nepal", "נפאל",
  "cambodia", "קמבודיה",
  "myanmar", "מיאנמר",
  "nigeria", "nigerian", "ניגריה",
  "kenya", "kenyan", "קניה",
  "ghana", "גאנה",
  "ethiopia", "אתיופיה",
  "tanzania", "טנזניה",
  "uganda", "אוגנדה",
  "egypt", "egyptian", "מצרים",
  "south africa", "דרום אפריקה",
  "morocco", "מרוקו",
  "tunisia", "תוניסיה",
  "brazil", "brazilian", "ברזיל",
  "mexico", "mexican", "מקסיקו",
  "argentina", "argentine", "ארגנטינה",
  "chile", "chilean", "צילה",
  "colombia", "קולומביה",
  "peru", "פרו",
  "turkey", "turkish", "טורקיה",
  "russia", "russian", "רוסיה",
  "ukraine", "ukrainian", "אוקראינה",
  "poland", "polish", "פולין",
  "romania", "רומניה",
  "hungary", "הונגריה",
  "czech", "צכיה",
  "greece", "greek", "יוון",
  "saudi arabia", "saudi", "סעודיה",
  "emirates", "uae", "אמירויות",
  "qatar", "קטאר",
  "bahrain", "בחריין",
  "jordan", "jordanian", "ירדן",
  "australia", "australian", "אוסטרליה",
  "new zealand", "ניו זילנד",
];

/**
 * Markers that make an item TRAVEL — the "מחקר, רגולציה עולמית, שחקן גלובלי" road out of
 * the geography gate, and the reason a BIS or IMF paper reaches Pazit while a Manila
 * feature does not.
 *
 * Two groups, both country-agnostic by construction:
 *   - explicit global scope ("global", "worldwide", "עולמי", "בינלאומי")
 *   - the multilateral bodies and report houses whose output is written FOR every market
 * Anything industry-specific belongs on the pack, and arrives as `person.globalPlayers`.
 */
const GLOBAL_MARKER_FORMS: string[] = [
  "global", "globally", "worldwide", "international", "cross border", "multinational",
  "עולמי", "עולמית", "בעולם", "גלובלי", "גלובלית", "בינלאומי", "בינלאומית", "חוצה גבולות",
  "bis", "bank for international settlements", "imf", "international monetary fund",
  "world bank", "fsb", "financial stability board", "basel", "basel committee",
  "oecd", "fatf", "world economic forum", "wef", "eba", "european banking authority",
  "ecb", "european central bank", "iosco", "bcbs",
  "mckinsey", "boston consulting", "bcg", "deloitte", "pwc", "kpmg", "accenture",
  "gartner", "forrester",
];

/**
 * A global marker OUTRANKS a foreign one, which is not a tie-break but the rule.
 *
 * "IMF warns on household credit growth in Brazil, Indonesia and the Philippines" names
 * three foreign markets and is still a global regulatory story a retail banking head
 * would forward. The inverse ordering would block exactly the material the gate is
 * supposed to let through.
 */
function travels(item: FloorItem, person: FloorPerson): boolean {
  if (GLOBAL_MARKER_FORMS.some((form) => containsFormAnywhere(item, tokens(form), wordIs))) return true;
  return (person.globalPlayers ?? []).some((name) => {
    const formTokens = tokens(name);
    return formTokens.length > 0 && containsFormAnywhere(item, formTokens, wordIs);
  });
}

/** The foreign market this item is local to, or null. */
function foreignLocalMarket(item: FloorItem): string | null {
  for (const form of FOREIGN_MARKET_FORMS) {
    if (containsFormAnywhere(item, tokens(form), wordIs)) return form;
  }
  return null;
}

/**
 * Floor 0: everything that can reject an item with no LLM and no triage.
 *
 * The order is by CERTAINTY, not by cost — all three are microseconds. `notOwns` runs
 * before geography because a line this person does not hold is true of them permanently,
 * while geography is a judgement about one article; when both would reject, the reported
 * reason should be the one no threshold will ever move.
 */
export function prefilter(item: FloorItem, person: FloorPerson): PrefilterVerdict {
  if (industryMismatch(item, person)) {
    return { pass: false, reason: "industry_mismatch", detail: item.industryKey ?? undefined };
  }

  const line = notOwnedLine(item, person.scope ?? null);
  if (line) return { pass: false, reason: "not_owned", detail: line };

  const market = homeMarket(person.audience ?? null);
  if (market && !isDomestic(item, market) && !travels(item, person)) {
    const foreign = foreignLocalMarket(item);
    if (foreign) return { pass: false, reason: "foreign_local", detail: foreign };
  }

  return { pass: true };
}

// ─── Floor 1: tag overlap ────────────────────────────────────────────────────

export type EntityTag = { name: string; aliases: string[] };

/**
 * Shortest entity form allowed to match. Matching is token-EXACT rather than substring,
 * so two characters is already safe; one is not, because a single letter is a token in
 * every headline ("A new bank opens").
 */
const MIN_ENTITY_FORM_CHARS = 2;

/**
 * The canonical name of the first tracked entity this item names, or null.
 *
 * Matched in CODE, never by an LLM — which is the only reason a personal, open-ended
 * vocabulary can sit beside a closed taxonomy without the synonym failure that text
 * overlap has in fit.ts. The name discipline is `competitorGazetteer`'s, one step
 * stricter: an entry is split on `/`, `|` and `,` so a research string that still carries
 * both scripts ("Bank Leumi / בנק לאומי / לאומי") is matchable either way, and the match
 * itself is token-exact so "לאומי" is not read out of "בינלאומי".
 *
 * The hit belongs to whoever tracks the name. "One Zero" in a title is news for Pazit and
 * for nobody else in the org, which is exactly what makes it the strongest tier.
 */
export function entityHit(item: FloorItem, entities: EntityTag[]): string | null {
  for (const entity of entities ?? []) {
    const name = typeof entity?.name === "string" ? entity.name.trim() : "";
    if (!name) continue;
    const raw = [name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])];
    for (const entry of raw) {
      // Same split as competitorGazetteer: one stored entry may hold several spellings.
      for (const part of String(entry ?? "").split(/[/|,]/)) {
        const form = part.trim();
        if (form.replace(/\s+/g, "").length < MIN_ENTITY_FORM_CHARS) continue;
        const formTokens = tokens(form);
        if (formTokens.length === 0) continue;
        if (containsFormAnywhere(item, formTokens, wordIs)) return name;
      }
    }
  }
  return null;
}

export type TagTier = "entity" | "focused" | "broad" | "none";

export type TagOverlap = {
  tier: TagTier;
  /** What matched, in the PERSON's spelling: the entity name, or their tags. */
  matched: string[];
};

/** Compares two closed-taxonomy tags: same characters, any casing or padding. */
function tagKey(tag: string): string {
  return String(tag ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The highest tier at which this item reaches this person, and what matched.
 *
 * Tiers are checked strongest-first and the strongest one WINS OUTRIGHT — a focused hit
 * does not accumulate broad hits alongside it. The tiers answer different questions
 * ("is this his?" vs "is this his industry's?"), and mixing them is how a `minBroad` count
 * would start being satisfied by the industry net riding along on a personal hit.
 */
export function tagOverlap(item: FloorItem, tags: { focused: string[]; broad: string[]; entities: EntityTag[] }): TagOverlap {
  const entity = entityHit(item, tags.entities ?? []);
  if (entity) return { tier: "entity", matched: [entity] };

  const itemTags = new Set((item.industryTags ?? []).map(tagKey).filter(Boolean));
  if (itemTags.size === 0) return { tier: "none", matched: [] };

  const overlap = (personTagList: string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tag of personTagList ?? []) {
      const key = tagKey(tag);
      if (!key || seen.has(key) || !itemTags.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out;
  };

  const focused = overlap(tags.focused ?? []);
  if (focused.length > 0) return { tier: "focused", matched: focused };
  const broad = overlap(tags.broad ?? []);
  if (broad.length > 0) return { tier: "broad", matched: broad };
  return { tier: "none", matched: [] };
}

// ─── Floor 1: the candidacy thresholds ───────────────────────────────────────

/**
 * Broad tags needed when NOTHING focused and no entity matched.
 *
 * Two, because one broad tag is what every C-level in the industry shares: the broad tier
 * IS the shared industry net, and a floor of one would make the net a firehose again.
 */
export const MIN_BROAD_TAGS = 2;

/**
 * The stature a broad-only item must carry — `INDUSTRY_ONLY_STATURE_FLOOR` restated in tag
 * terms rather than copied.
 *
 * It is imported, not re-declared as 0.8: the two are the SAME rule ("an item matched only
 * by the shared industry net is too generic to draft on unless it has real weight"), the
 * layer version reading axis kinds and this one reading tiers. A second literal would be a
 * number that drifts.
 */
export const BROAD_STATURE_FLOOR = INDUSTRY_ONLY_STATURE_FLOOR;

export type FloorThresholds = { minBroad: number; broadStatureFloor: number };

/** A positive finite override, or the default. A garbled env var must not yield NaN. */
function envNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The thresholds, read from env at CALL time.
 *
 * Call time and not module load, so a script can set the bar for one run — the way
 * RADAR_MAX_DRAFTS_PER_DAY is passed on the command that runs a scan and never set on the
 * container. Task 7 saves every rejected item with the floor it failed, and these two
 * numbers are what those rows exist to calibrate; a threshold that needs a deploy to move
 * is a threshold nobody will move.
 */
export function floorThresholds(): FloorThresholds {
  return {
    minBroad: envNumber(process.env.RADAR_MIN_BROAD_TAGS, MIN_BROAD_TAGS),
    broadStatureFloor: envNumber(process.env.RADAR_BROAD_STATURE_FLOOR, BROAD_STATURE_FLOOR),
  };
}

export type FloorInput = {
  overlap: TagOverlap;
  /** From triage. Only the broad tier reads it. */
  stature: number;
};

export type FloorVerdict = {
  pass: boolean;
  /** Carried through so a saved drop-out says which floor it died on. */
  tier: TagTier;
  reason: "entity_hit" | "focused_tag" | "broad_tags" | "broad_too_few" | "broad_low_stature" | "no_tag";
};

/**
 * Floor 1's verdict: is this item a CANDIDATE for this person?
 *
 * Candidate, not a draft. Everything that passes here goes to the chooser (one Haiku call
 * per person per scan) and then to the unchanged Opus veto. Each floor corrects a
 * different error — tags prevent a miss, the chooser prevents mediocrity, the veto
 * prevents a fake — so this one is tuned for RECALL and says so.
 */
export function passesFloors(input: FloorInput, thresholds: FloorThresholds = floorThresholds()): FloorVerdict {
  const { tier, matched } = input.overlap;
  if (tier === "entity") return { pass: true, tier, reason: "entity_hit" };
  if (tier === "focused") return { pass: true, tier, reason: "focused_tag" };
  if (tier === "broad") {
    if (matched.length < thresholds.minBroad) return { pass: false, tier, reason: "broad_too_few" };
    if (!(input.stature >= thresholds.broadStatureFloor)) {
      return { pass: false, tier, reason: "broad_low_stature" };
    }
    return { pass: true, tier, reason: "broad_tags" };
  }
  return { pass: false, tier: "none", reason: "no_tag" };
}
