import type { NewsResult } from "@/lib/news/types";

/** Serper.dev news search — https://serper.dev. Free credits then ~$0.001/query.
 *  Missing key or any error → [] (never throws). */
export async function fetchSerper(query: string): Promise<NewsResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
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
    if (!res.ok) return [];
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
