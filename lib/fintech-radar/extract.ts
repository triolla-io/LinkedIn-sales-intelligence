/**
 * LLM extraction + tagging of fintech news items from merged provider results.
 * Mirrors lib/company-signals/extract.ts. Missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
import type { NewsResult } from "@/lib/news/types";

export type ExtractedArticle = {
  title: string;
  url: string;
  summary: string;
  topics: string[];
  mentionedCompanies: string[];
  relevantRoles: string[];
  publishedAt: string | null;
};

const SYSTEM = `You clean and TAG fintech news items for a B2B sales team.

For each DISTINCT fintech news item in the results, return:
- title: concise headline
- url: the exact source URL from the results (never invent one)
- summary: 1-2 factual sentences
- topics: 1-4 short lowercase tags from this controlled set only:
  ["payments","stablecoin","crypto","embedded-finance","open-banking","lending","bnpl",
   "regtech","wealthtech","insurtech","neobank","ai-in-finance","funding","m&a","infrastructure"]
- mentionedCompanies: company names explicitly named in the item (["Stripe","MoonPay"]); [] if none
- relevantRoles: seniority/role types who'd care, from this set only:
  ["cfo","cto","ceo","coo","head-of-payments","head-of-product","compliance","risk","founder","vp-engineering","vp-finance"]
- publishedAt: "YYYY-MM-DD" or null

STRICT RULES:
- Only fintech-relevant items. Skip unrelated general business/tech news.
- Every item MUST carry a real url taken from the results. If none, DROP it.
- Do not invent companies, tags, or URLs. Merge obvious duplicates into one item.

Return strict JSON only — no prose, no markdown fences:
{"articles":[{"title":"...","url":"https://...","summary":"...","topics":["payments"],"mentionedCompanies":["Acme"],"relevantRoles":["cfo"],"publishedAt":"2026-07-20"}]}`;

function userPrompt(news: NewsResult[]): string {
  const lines = news.slice(0, 60).map(
    (n, i) => `[${i + 1}] (${n.source}) ${n.title}\n${n.snippet}\nURL: ${n.url}\nDate: ${n.publishedAt ?? "unknown"}`
  );
  return `Fintech news results:\n${lines.join("\n\n")}`;
}

const ALLOWED_TOPICS = new Set(["payments","stablecoin","crypto","embedded-finance","open-banking","lending","bnpl","regtech","wealthtech","insurtech","neobank","ai-in-finance","funding","m&a","infrastructure"]);
const ALLOWED_ROLES = new Set(["cfo","cto","ceo","coo","head-of-payments","head-of-product","compliance","risk","founder","vp-engineering","vp-finance"]);

export function parseArticlesResponse(text: string): ExtractedArticle[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  const rows = (parsed as { articles?: unknown })?.articles;
  if (!Array.isArray(rows)) return [];
  const out: ExtractedArticle[] = [];
  for (const r of rows) {
    const o = r as Record<string, unknown>;
    const url = String(o.url ?? "").trim();
    const title = String(o.title ?? "").trim();
    if (!url || !title) continue;
    const strArr = (v: unknown, allowed?: Set<string>) =>
      (Array.isArray(v) ? v.map((x) => String(x).toLowerCase().trim()) : []).filter((x) => x && (!allowed || allowed.has(x)));
    out.push({
      title,
      url,
      summary: String(o.summary ?? "").trim(),
      topics: strArr(o.topics, ALLOWED_TOPICS),
      mentionedCompanies: Array.isArray(o.mentionedCompanies) ? o.mentionedCompanies.map((x) => String(x).trim()).filter(Boolean) : [],
      relevantRoles: strArr(o.relevantRoles, ALLOWED_ROLES),
      publishedAt: typeof o.publishedAt === "string" && o.publishedAt.trim() ? o.publishedAt.trim() : null,
    });
  }
  return out;
}

export async function extractArticles(news: NewsResult[]): Promise<ExtractedArticle[]> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured — refusing to extract fintech articles");
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
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
          { role: "user", content: userPrompt(news) },
        ],
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`fintech-radar extract failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return parseArticlesResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}
