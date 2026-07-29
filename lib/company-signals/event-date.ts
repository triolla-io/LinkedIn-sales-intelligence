/**
 * Pure date helpers for company-signals — shared by server (create-drafts) and the
 * client feed page. MUST stay prisma-free (client components import this).
 */
export type SourceDate = { publishedAt: string | null };

function toIsoDay(value: string | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** eventDate if present, else the earliest parseable source publishedAt, else null. */
export function resolveEventDate(eventDate: string | null, sources: SourceDate[]): string | null {
  const own = toIsoDay(eventDate);
  if (own) return own;
  const days = sources
    .map((s) => toIsoDay(s.publishedAt))
    .filter((d): d is string => d !== null)
    .sort();
  return days[0] ?? null;
}

/** "2026-07-05" → "5.7.2026" for display; null/garbage → null. */
export function formatEventDate(iso: string | null): string | null {
  const day = toIsoDay(iso);
  if (!day) return null;
  const [y, m, d] = day.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}
