/**
 * The canonical query pool — the feature's main cost lever.
 *
 * Every tracked company's profile contributes its own search queries, and at
 * scale those overlap heavily: fifty fintech companies will independently ask
 * for "open banking API launch". Grouping by a normalized form means each
 * distinct query is executed ONCE per run and its results are shared with every
 * company that asked for it, which is roughly a 6x reduction in provider calls
 * at 50 companies. If this grouping breaks, spend silently multiplies.
 *
 * Pure — no prisma, no LLM. Deterministic output so Inngest step replays match.
 */
import { MAX_QUERIES_PER_COMPANY } from "@/lib/tech-radar/types";

/**
 * Grouping key only — NEVER the string sent to a provider. Boolean operators and
 * parentheses are preserved because they are meaningful to the search APIs;
 * everything else is flattened so trivial phrasing differences collapse.
 */
export function normalizeQuery(q: string): string {
  if (typeof q !== "string") return "";
  let s = q.toLowerCase().trim();
  // Strip a matched pair of surrounding quotes (a fully-quoted phrase), not
  // internal ones, which scope a phrase inside a larger boolean query.
  while (s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  s = s
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Nothing but punctuation or operators is not a query.
  if (!/[\p{L}\p{N}]/u.test(s)) return "";
  return s;
}

export type QuerySubscription = { query: string; companyIds: string[] };

export function buildQueryPool(
  companies: { id: string; searchQueries: string[] }[]
): QuerySubscription[] {
  // key -> { representative original query, subscribing company ids }
  const pool = new Map<string, { query: string; companyIds: string[] }>();

  for (const company of companies) {
    const queries = Array.isArray(company.searchQueries) ? company.searchQueries : [];
    let used = 0;
    const seenForCompany = new Set<string>();

    for (const raw of queries) {
      if (used >= MAX_QUERIES_PER_COMPANY) break;
      if (typeof raw !== "string") continue;
      const key = normalizeQuery(raw);
      if (!key) continue;
      // A company asking twice for the same thing spends one of its slots, once.
      if (seenForCompany.has(key)) continue;
      seenForCompany.add(key);
      used += 1;

      const entry = pool.get(key);
      if (entry) {
        if (!entry.companyIds.includes(company.id)) entry.companyIds.push(company.id);
      } else {
        // Keep the ORIGINAL string for execution — normalization is for grouping.
        pool.set(key, { query: raw.trim(), companyIds: [company.id] });
      }
    }
  }

  return [...pool.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => ({ query: v.query, companyIds: [...v.companyIds].sort() }));
}
