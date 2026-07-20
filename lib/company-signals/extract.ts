/**
 * LLM extraction of positive company events from merged live-news results, plus the pure
 * verify/dedup helpers. Mirrors the OpenRouter pattern in lib/enrichment/openrouter-search.ts
 * and lib/job-check/judge-change.ts. A missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
import type { NewsResult } from "@/lib/news/types";

export type SignalTypeStr =
  | "FUNDING" | "HIRING_GROWTH" | "OFFICE_MOVE" | "PRODUCT_LAUNCH"
  | "AWARD" | "MILESTONE" | "EXEC_HIRE";

const SIGNAL_TYPES: SignalTypeStr[] = [
  "FUNDING", "HIRING_GROWTH", "OFFICE_MOVE", "PRODUCT_LAUNCH", "AWARD", "MILESTONE", "EXEC_HIRE",
];

export type ExtractedSignal = {
  signalType: SignalTypeStr;
  title: string;
  summary: string;
  eventDate: string | null;
  sources: { name: string; url: string; publishedAt: string | null }[];
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function computeVerified(
  sources: { url: string }[],
  companyWebsite: string | null
): { verified: boolean; confidence: number; distinctDomains: number } {
  const domains = new Set<string>();
  for (const s of sources) {
    const h = hostOf(s.url);
    if (h) domains.add(h);
  }
  const distinctDomains = domains.size;
  const officialHost = companyWebsite ? hostOf(companyWebsite) : null;
  const hasOfficial = officialHost !== null && domains.has(officialHost);
  const verified = distinctDomains >= 2 || hasOfficial;
  // confidence: 1 domain → 0.4, 2 → 0.7, 3+ → 0.9; official bumps to at least 0.8
  let confidence = distinctDomains >= 3 ? 0.9 : distinctDomains === 2 ? 0.7 : 0.4;
  if (hasOfficial) confidence = Math.max(confidence, 0.8);
  return { verified, confidence, distinctDomains };
}

export function makeDedupeKey(signalType: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return `${signalType}:${slug}`;
}

const SYSTEM = `You extract POSITIVE, congratulation-worthy company events from news search results.

Only include events worth sending a "mazal tov / congratulations" message about:
- FUNDING (raised a round), HIRING_GROWTH (significant hiring / headcount growth),
  OFFICE_MOVE (moved to a bigger/new office), PRODUCT_LAUNCH (launched a product/tool/feature),
  AWARD (won an award/recognition), MILESTONE (IPO, big customer, major anniversary),
  EXEC_HIRE (appointed a senior executive).

STRICT RULES:
- IGNORE negative or neutral news (layoffs, lawsuits, losses, outages, controversy). Never emit them.
- Every event MUST carry at least one source with a real URL taken from the provided results. If you cannot attach a source URL, DROP the event.
- Do not invent events, numbers, or URLs. Only use what the results support.
- Prefer recent events (last ~30 days).

Return strict JSON only — no prose, no markdown fences:
{"events":[{"signalType":"FUNDING","title":"short headline","summary":"1-2 sentences","eventDate":"YYYY-MM-DD or null","sources":[{"name":"Publication","url":"https://…","publishedAt":"YYYY-MM-DD or null"}]}]}`;

function userPrompt(companyName: string, news: NewsResult[]): string {
  const lines = news.slice(0, 30).map(
    (n, i) => `[${i + 1}] (${n.source}) ${n.title}\n${n.snippet}\nURL: ${n.url}\nDate: ${n.publishedAt ?? "unknown"}`
  );
  return `Company: ${companyName}\n\nNews results:\n${lines.join("\n\n")}`;
}

export function parseSignalsResponse(text: string): ExtractedSignal[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  const events = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: ExtractedSignal[] = [];
  for (const e of events) {
    const o = e as Record<string, unknown>;
    if (!SIGNAL_TYPES.includes(o.signalType as SignalTypeStr)) continue;
    const rawSources = Array.isArray(o.sources) ? o.sources : [];
    const sources = rawSources
      .map((s) => {
        const so = s as Record<string, unknown>;
        return {
          name: typeof so.name === "string" ? so.name : "",
          url: typeof so.url === "string" ? so.url : "",
          publishedAt: typeof so.publishedAt === "string" ? so.publishedAt : null,
        };
      })
      .filter((s) => s.url.startsWith("http"));
    if (sources.length === 0) continue; // no URL → drop
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    out.push({
      signalType: o.signalType as SignalTypeStr,
      title,
      summary: typeof o.summary === "string" ? o.summary : "",
      eventDate: typeof o.eventDate === "string" ? o.eventDate : null,
      sources,
    });
  }
  return out;
}

export async function extractCompanySignals(
  companyName: string,
  news: NewsResult[]
): Promise<ExtractedSignal[]> {
  if (news.length === 0) return [];
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured — refusing to extract company signals");
  }
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(companyName, news) },
        ],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`company-signals extract failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return parseSignalsResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}
