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
      "group product manager", "product fellow", "distinguished product manager",
      "product lead", "product manager", "product owner",
      'סמנכ"ל מוצר', 'סמנכ"לית מוצר', "ראש תחום מוצר", "ראש מוצר",
      "מנהל מוצר", "מנהלת מוצר", "דירקטור מוצר", "דירקטור ניהול מוצר",
      "דירקטור בכיר לניהול מוצר", "ראש קבוצת מוצר", "מוביל מוצר", "מובילת מוצר",
    ],
  },
  {
    key: "CEO_FOUNDER",
    triggers: ["ceo", "founder", "co-founder", "chief executive officer", 'מנכ"ל', "מייסד"],
    patterns: [
      "chief executive officer", "ceo", "founder", "owner",
      'מנכ"ל', 'מנכ"לית', "מייסד", "בעלים",
    ],
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
