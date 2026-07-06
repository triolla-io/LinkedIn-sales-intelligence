export type RankableContact = {
  fullName: string;
  hebrewFirstName?: string | null;
};

/**
 * Re-order search matches by relevance so the person the user typed surfaces
 * first — even when many contacts match and the naive `fullName asc` + `take`
 * slice would otherwise bury them under alphabetically-earlier names.
 *
 * The DB `where` already decided *which* rows match (across name, company,
 * title, email); this only decides their order. Ranking, best first:
 *   0 — a name field (fullName / hebrewFirstName) *starts with* the query
 *   1 — a name field *contains* the query
 *   2 — matched only on a secondary field (company / title / email)
 * Ties keep the incoming order, which the caller supplies as `fullName asc`.
 */
export function rankSearchResults<T extends RankableContact>(rows: T[], q: string): T[] {
  const query = q.trim().toLowerCase();
  if (!query) return rows;

  const score = (row: T): number => {
    const names = [row.fullName, row.hebrewFirstName]
      .filter((n): n is string => Boolean(n))
      .map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(query))) return 0;
    if (names.some((n) => n.includes(query))) return 1;
    return 2;
  };

  return rows
    .map((row, index) => ({ row, index, score: score(row) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.row);
}
