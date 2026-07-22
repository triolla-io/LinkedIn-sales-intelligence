import type { NewsResult } from "@/lib/news/types";
import { fetchTavily } from "@/lib/news/tavily";
import { fetchGnews } from "@/lib/news/gnews";
import { fetchSerper } from "@/lib/news/serper";
import { FINTECH_TOPICS } from "@/lib/fintech-radar/topics";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_)/i;

/** Canonical form for dedupe: https + lowercased host, no www, no tracking params, no trailing slash. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.host = u.host.replace(/^www\./i, "").toLowerCase();
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    }
    let s = u.toString();
    s = s.replace(/\/(\?|$)/, (_, tail) => (tail === "?" ? "?" : ""));
    return s;
  } catch {
    return url;
  }
}

/** Fan out every topic across providers (last ~10 days), merge, dedupe by normalized URL. */
export async function fetchTopicNews(): Promise<NewsResult[]> {
  const perTopic = await Promise.all(
    FINTECH_TOPICS.map(async (q) => {
      const [a, b, c] = await Promise.all([
        fetchTavily(q, { days: 7, maxResults: 10 }),
        fetchGnews(q, { max: 10 }),
        fetchSerper(q),
      ]);
      return [...a, ...b, ...c];
    })
  );
  const seen = new Set<string>();
  const merged: NewsResult[] = [];
  for (const r of perTopic.flat()) {
    if (!r.url) continue;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged;
}
