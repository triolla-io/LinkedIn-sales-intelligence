// Role-family dictionary for smarter role search. A single business role has
// many title variants in English and Hebrew (CPO / Chief Product Officer /
// VP Product / סמנכ"ל מוצר …). When a search query or title pill matches a
// family's trigger, the API expands it into the family's full pattern list.
// Matching is substring-based (Prisma `contains`, case-insensitive), so a
// pattern like "vice president of product" also catches
// "Executive Vice President of Product".
//
// Adding a family or variant = editing this file only.

export type RoleFamily = {
  key: string;
  /** Normalized queries that select this family (see normalizeRoleQuery). */
  triggers: string[];
  /** Title substrings searched in the DB. Write Hebrew with ASCII `"`;
   *  gershayim/no-quote variants are generated automatically. */
  patterns: string[];
  /** Curated ASCII LinkedIn people-search queries for this family.
   *  Each MUST normalize to one of this family's triggers. */
  searchTerms: string[];
};

export const ROLE_FAMILIES: RoleFamily[] = [
  {
    key: "PRODUCT_LEADERSHIP",
    triggers: [
      "cpo", "cpto", "chief product officer",
      "product manager", "pm", "gpm", "group product manager",
      "vp product", "vp of product", "svp product", "evp product",
      "head of product", "product director", "director of product",
      "product lead", "product",
      'סמנכ"ל מוצר', "מנהל מוצר", "ראש תחום מוצר", "דירקטור מוצר",
    ],
    patterns: [
      "chief product officer", "cpo", "cpto", "chief product and technology",
      "vice president of product", "vice president, product",
      "vp product", "vp of product", "vp, product",
      "svp product", "svp of product", "evp product", "evp of product",
      "head of product", "director of product", "product director",
      "product management director", "product tribe lead",
      "group product manager", "product group manager",
      "product fellow", "distinguished product manager",
      "product lead", "product manager", "product owner",
      'סמנכ"ל מוצר', 'סמנכ"לית מוצר', "ראש תחום מוצר", "ראש מוצר",
      "מנהל מוצר", "מנהלת מוצר", "דירקטור מוצר", "דירקטור ניהול מוצר",
      "דירקטור בכיר לניהול מוצר", "ראש קבוצת מוצר", "מוביל מוצר", "מובילת מוצר",
    ],
    searchTerms: ["CPO", "VP Product", "Head of Product"],
  },
  {
    key: "CEO_FOUNDER",
    triggers: ["ceo", "founder", "co-founder", "chief executive officer", 'מנכ"ל', "מייסד"],
    patterns: [
      "chief executive officer", "ceo", "founder", "owner",
      'מנכ"ל', 'מנכ"לית', "מייסד", "בעלים",
    ],
    searchTerms: ["CEO", "Founder"],
  },
  {
    key: "OPERATIONS_LEADERSHIP",
    triggers: ["coo", "chief operating officer", "vp operations", "head of operations", 'סמנכ"ל תפעול'],
    patterns: [
      "chief operating officer", "coo",
      "vice president of operations", "vp operations", "vp of operations",
      "head of operations", "operations director", "director of operations",
      'סמנכ"ל תפעול', 'סמנכ"לית תפעול', "מנהל תפעול", "מנהלת תפעול", "ראש תחום תפעול",
    ],
    searchTerms: ["COO", "VP Operations", "Head of Operations"],
  },
  {
    key: "FINANCE_LEADERSHIP",
    triggers: ["cfo", "chief financial officer", "vp finance", "head of finance", 'סמנכ"ל כספים'],
    patterns: [
      "chief financial officer", "cfo",
      "vice president of finance", "vp finance", "vp of finance",
      "head of finance", "finance director", "director of finance",
      'סמנכ"ל כספים', 'סמנכ"לית כספים', "מנהל כספים", "מנהלת כספים",
    ],
    searchTerms: ["CFO", "VP Finance", "Head of Finance"],
  },
  {
    key: "TECHNOLOGY_LEADERSHIP",
    triggers: [
      "cto", "chief technology officer", "vp engineering", "vp r&d",
      "head of engineering", "head of r&d", 'סמנכ"ל פיתוח', 'סמנכ"ל טכנולוגיות',
    ],
    patterns: [
      "chief technology officer", "chief technical officer", "cto",
      "vice president of engineering", "vp engineering", "vp of engineering",
      "vice president of r&d", "vp r&d", "vp of r&d",
      "head of engineering", "head of r&d", "r&d director",
      "director of engineering", "engineering director",
      'סמנכ"ל טכנולוגיות', 'סמנכ"ל פיתוח', 'סמנכ"ל מו"פ',
      "מנהל פיתוח", "מנהלת פיתוח", "ראש תחום פיתוח", 'מנהל מו"פ',
    ],
    searchTerms: ["CTO", "VP Engineering", "VP R&D"],
  },
  {
    key: "MARKETING_LEADERSHIP",
    triggers: ["cmo", "chief marketing officer", "vp marketing", "head of marketing", 'סמנכ"ל שיווק'],
    patterns: [
      "chief marketing officer", "cmo",
      "vice president of marketing", "vp marketing", "vp of marketing",
      "head of marketing", "marketing director", "director of marketing",
      'סמנכ"ל שיווק', 'סמנכ"לית שיווק', "מנהל שיווק", "מנהלת שיווק", "ראש תחום שיווק",
    ],
    searchTerms: ["CMO", "VP Marketing", "Head of Marketing"],
  },
  {
    key: "HR_LEADERSHIP",
    triggers: ["hr", "chro", "chief people officer", "vp hr", "head of hr", "head of people", 'סמנכ"ל משאבי אנוש'],
    patterns: [
      "chief people officer", "chro", "chief human resources officer",
      "vp hr", "vp of hr", "vp people", "vp of people",
      "head of hr", "head of people", "hr director", "hr manager",
      "human resources director", "director of human resources",
      'סמנכ"ל משאבי אנוש', 'סמנכ"לית משאבי אנוש', "מנהל משאבי אנוש", "מנהלת משאבי אנוש",
    ],
    searchTerms: ["CHRO", "VP HR", "Head of HR"],
  },
  {
    key: "SALES_LEADERSHIP",
    triggers: ["cro", "chief revenue officer", "vp sales", "head of sales", "sales director", 'סמנכ"ל מכירות'],
    patterns: [
      "chief revenue officer", "cro", "chief sales officer",
      "vice president of sales", "vp sales", "vp of sales",
      "head of sales", "sales director", "director of sales",
      "vp business development", "head of business development", "business development director",
      'סמנכ"ל מכירות', 'סמנכ"לית מכירות', "מנהל מכירות", "מנהלת מכירות",
      "ראש תחום מכירות", "מנהל פיתוח עסקי", 'סמנכ"ל פיתוח עסקי',
    ],
    searchTerms: ["CRO", "VP Sales", "Head of Sales"],
  },
  {
    key: "DESIGN_LEADERSHIP",
    triggers: ["head of design", "vp design", "design director", "chief design officer", 'סמנכ"ל עיצוב'],
    patterns: [
      "chief design officer", "head of design",
      "vice president of design", "vp design", "vp of design",
      "design director", "director of design",
      "head of ux", "ux director", "creative director",
      'סמנכ"ל עיצוב', "מנהל עיצוב", "מנהלת עיצוב", "ראש תחום עיצוב",
    ],
    searchTerms: ["Head of Design", "VP Design"],
  },
];

const QUOTE_CHARS = /["״'׳’“”]/g; // " ״ ' ׳ ’ “ ”

/** Lowercase, strip quote-like chars, collapse whitespace. */
export function normalizeRoleQuery(s: string): string {
  return s.toLowerCase().replace(QUOTE_CHARS, "").replace(/\s+/g, " ").trim();
}

/** DB text may use ASCII ", Hebrew gershayim ״, or no quote — emit all forms. */
function quoteVariants(pattern: string): string[] {
  if (!pattern.includes('"')) return [pattern];
  return [
    pattern,
    pattern.replace(/"/g, "״"),
    pattern.replace(/"/g, ""),
  ];
}

const TRIGGER_MAP = new Map<string, RoleFamily>();
for (const family of ROLE_FAMILIES) {
  for (const trigger of family.triggers) {
    TRIGGER_MAP.set(normalizeRoleQuery(trigger), family);
  }
}

/**
 * If `q` looks like a known role, return the family's full pattern list
 * (with quote variants) for substring matching; otherwise null.
 */
export function expandRoleQuery(q: string): string[] | null {
  const family = TRIGGER_MAP.get(normalizeRoleQuery(q));
  if (!family) return null;
  return [...new Set(family.patterns.flatMap(quoteVariants))];
}

/** Pure-ASCII check (Latin, LinkedIn-searchable). */
function isAscii(s: string): boolean {
  for (const ch of s) if (ch.charCodeAt(0) > 127) return false;
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve a searched/typed title to its role family (or null). */
export function resolveRoleFamily(title: string): RoleFamily | null {
  return TRIGGER_MAP.get(normalizeRoleQuery(title)) ?? null;
}

/** The family's curated LinkedIn search terms for a title, or null if unknown. */
export function expandTitleToSearchTerms(title: string): string[] | null {
  return resolveRoleFamily(title)?.searchTerms ?? null;
}

/**
 * True when `headline` shows the person holds any leadership variant in `family`.
 * ASCII patterns match with word boundaries (so "coo" never matches inside "cool");
 * Hebrew patterns match as substrings across all quote variants.
 */
/**
 * Seniority words that may sit one qualifier away from the function they lead — "VP of Product
 * Management", "Head of Global Product", "Chief Global Product Officer". Only patterns that START
 * with one of these earn gap tolerance: the level word anchors seniority, so precision holds
 * (adjacent functions like "VP Marketing | Product Support" still fail — see TOKEN_GAP).
 */
const LEVEL_FIRST_TOKENS = new Set([
  "vp", "svp", "evp", "avp", "vice", "president",
  "head", "chief", "director", "deputy",
]);

/**
 * One optional intervening qualifier between two pattern tokens. Only words and an optional comma
 * may fill the gap, so it can never cross a "|", "/", "(" or "-" separator — which is what keeps
 * "VP Marketing | Product Support" out of the product family.
 */
const TOKEN_GAP = ",?\\s+(?:[a-z&.]+,?\\s+)?";

const patternRegexCache = new Map<string, RegExp>();

/** Word-bounded regex for an ASCII pattern; level-anchored patterns tolerate one gap word. */
function asciiPatternRegex(pattern: string): RegExp {
  const cached = patternRegexCache.get(pattern);
  if (cached) return cached;
  const tokens = pattern.split(/\s+/).filter(Boolean);
  const body =
    tokens.length > 1 && LEVEL_FIRST_TOKENS.has(tokens[0])
      ? tokens.map(escapeRegExp).join(TOKEN_GAP)
      : escapeRegExp(pattern);
  const re = new RegExp(`\\b${body}\\b`);
  patternRegexCache.set(pattern, re);
  return re;
}

export function familyHeadlineMatches(family: RoleFamily, headline: string): boolean {
  if (!headline) return false;
  const lower = headline.toLowerCase();
  for (const pattern of family.patterns) {
    if (isAscii(pattern)) {
      if (asciiPatternRegex(pattern.toLowerCase()).test(lower)) return true;
    } else {
      for (const variant of quoteVariants(pattern)) {
        if (headline.includes(variant)) return true;
      }
    }
  }
  return false;
}
