/**
 * Deterministic normalization for job-check comparisons. Catches naming variants
 * (casing, punctuation, legal suffixes, &/and) with zero LLM cost. Values that
 * still differ after normalization go to the LLM judge (judge-change.ts).
 */

// Suffix tokens stripped repeatedly from the end of a company name. Hebrew בע"מ
// has its gershayim stripped to empty (not space) before punctuation sweep, so
// it collapses to a single token בעמ.
const LEGAL_SUFFIX_TOKENS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "llc",
  "corp",
  "corporation",
  "co",
  "company",
  "group",
  "holdings",
  "בעמ",
]);

function baseNormalize(raw: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[״"'']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(raw: string | null): string {
  const tokens = baseNormalize(raw).split(" ").filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

export function normalizeTitle(raw: string | null): string {
  return baseNormalize(raw);
}
