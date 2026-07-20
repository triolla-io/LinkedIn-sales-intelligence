import type { NewsResult } from "@/lib/news/types";

/** GNews API — https://gnews.io. Free tier 100 req/day.
 *  Missing key or any error → [] (never throws). */
export async function fetchGnews(query: string): Promise<NewsResult[]> {
  const key = (process.env.GNEWS_API_KEY ?? "").trim();
  if (!key) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = new URL("https://gnews.io/api/v4/search");
    url.searchParams.set("q", query);
    url.searchParams.set("lang", "en");
    url.searchParams.set("max", "10");
    url.searchParams.set("apikey", key);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.articles) ? data.articles : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      const src = o.source as Record<string, unknown> | undefined;
      return {
        title: String(o.title ?? ""),
        url: String(o.url ?? ""),
        snippet: String(o.description ?? ""),
        source: `gnews:${src?.name ?? ""}`,
        publishedAt: typeof o.publishedAt === "string" ? o.publishedAt : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
