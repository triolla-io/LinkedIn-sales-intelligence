import type { NewsResult } from "@/lib/news/types";
import { reserveNewsCall } from "@/lib/news/budget";

/** Serper.dev news search — https://serper.dev. Free credits then ~$0.001/query.
 *  Missing key, budget exhausted, or any error → [] (never throws). */
export async function fetchSerper(query: string): Promise<NewsResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
  if (!(await reserveNewsCall("serper"))) return []; // cap monthly pay-per-query spend
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://google.serper.dev/news", {
      signal: controller.signal,
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10 }),
    });
    clearTimeout(timeout);
    if (!res.ok) {
      // A swallowed non-2xx is indistinguishable from "no news". Tavily returns 432
      // when the account plan limit is spent; that looked like an empty week during
      // the Tech Radar bring-up. Log the status; still never throw.
      console.warn(`[serper] HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.news) ? data.news : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: String(o.title ?? ""),
        url: String(o.link ?? ""),
        snippet: String(o.snippet ?? ""),
        source: "serper",
        publishedAt: typeof o.date === "string" ? o.date : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
