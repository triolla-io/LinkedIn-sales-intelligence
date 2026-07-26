import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";

/** Tavily Search API — https://docs.tavily.com. Free tier ~1,000 searches/mo.
 *  Missing key, budget exhausted, or any error → [] (never throws). */
export async function fetchTavily(
  query: string,
  opts: { days?: number; maxResults?: number } = {}
): Promise<NewsResult[]> {
  const key = (process.env.TAVILY_API_KEY ?? "").trim();
  if (!key) return [];
  if (!(await reserveNewsCall("tavily"))) return []; // stay inside the free monthly quota
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.tavily.com/search", {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        topic: "news",
        search_depth: "basic",
        max_results: opts.maxResults ?? 8,
        days: opts.days ?? 30,
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.results) ? data.results : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: String(o.title ?? ""),
        url: String(o.url ?? ""),
        snippet: String(o.content ?? ""),
        source: "tavily",
        publishedAt: typeof o.published_date === "string" ? o.published_date : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
