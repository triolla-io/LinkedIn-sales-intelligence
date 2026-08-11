import { Prisma } from "@/lib/generated/prisma/client";
import { seniorTitleWhere } from "@/lib/company-signals/clevel";
import { openrouterChat } from "@/lib/openrouter/client";

export const CANDIDATE_CAP = 25;

/** Topic tag -> industry keywords we match against Contact.industry (case-insensitive contains). */
const TOPIC_INDUSTRY_TERMS: Record<string, string[]> = {
  payments: ["payment", "fintech", "financial"],
  stablecoin: ["crypto", "blockchain", "fintech", "financial"],
  crypto: ["crypto", "blockchain", "fintech"],
  "embedded-finance": ["fintech", "financial", "banking"],
  "open-banking": ["banking", "fintech", "financial"],
  lending: ["lending", "credit", "fintech", "financial"],
  bnpl: ["lending", "retail", "fintech"],
  regtech: ["compliance", "regulatory", "fintech", "financial"],
  wealthtech: ["wealth", "asset management", "investment", "fintech"],
  insurtech: ["insurance", "insurtech"],
  neobank: ["banking", "fintech"],
  "ai-in-finance": ["fintech", "financial", "banking"],
  funding: ["fintech", "financial", "venture"],
  "m&a": ["fintech", "financial"],
  infrastructure: ["fintech", "financial", "banking"],
};

/** Role tag -> title/headline keywords. */
const ROLE_TITLE_TERMS: Record<string, string[]> = {
  cfo: ["cfo", "chief financial", "finance"],
  cto: ["cto", "chief technolog", "chief technical"],
  ceo: ["ceo", "chief executive", 'מנכ"ל'],
  coo: ["coo", "chief operating"],
  "head-of-payments": ["head of payment", "payments"],
  "head-of-product": ["head of product", "chief product", "cpo"],
  compliance: ["compliance", "regulatory", "aml"],
  risk: ["risk"],
  founder: ["founder", "co-founder", "מייסד"],
  "vp-engineering": ["vp engineering", "vp r&d", "head of engineering"],
  "vp-finance": ["vp finance", "finance"],
};

export function buildCandidateWhere(
  ownerId: string,
  article: { topics: string[]; mentionedCompanies: string[]; relevantRoles: string[] }
): Prisma.ContactWhereInput {
  const overlap: Prisma.ContactWhereInput[] = [];

  for (const c of article.mentionedCompanies) {
    if (c.trim()) overlap.push({ currentCompany: { contains: c.trim(), mode: "insensitive" } });
  }
  const industryTerms = new Set(article.topics.flatMap((t) => TOPIC_INDUSTRY_TERMS[t] ?? []));
  for (const term of industryTerms) {
    overlap.push({ industry: { contains: term, mode: "insensitive" } });
  }
  const titleTerms = new Set(article.relevantRoles.flatMap((r) => ROLE_TITLE_TERMS[r] ?? []));
  for (const term of titleTerms) {
    overlap.push({ currentTitle: { contains: term, mode: "insensitive" } });
    overlap.push({ headline: { contains: term, mode: "insensitive" } });
  }

  const base: Prisma.ContactWhereInput = {
    ownerId,
    removedAt: null,
    // Radar keeps the wider senior pool (VP / head-of) — its topic map targets those roles.
    ...seniorTitleWhere(),
  };
  // When we have overlap signals, require at least one; otherwise fall back to plain seniority.
  return overlap.length > 0 ? { AND: [base, { OR: overlap }] } : base;
}

export type Candidate = {
  contactId: string;
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  industry: string | null;
  headline: string | null;
};
export type ConfirmedMatch = { contactId: string; score: number; reason: string };

const CONFIRM_SYSTEM = `You decide which of a sales rep's contacts would genuinely find a fintech news item relevant enough to receive a friendly outreach about it.

Return only contacts with a real, specific reason (their role/company/industry ties to the item). Be selective — omit weak matches.

Return strict JSON only — no prose, no fences:
{"matches":[{"contactId":"<id>","score":0.0-1.0,"reason":"one short sentence in Hebrew"}]}`;

export function parseConfirmResponse(text: string, validIds: Set<string>): ConfirmedMatch[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return []; }
  const rows = (parsed as { matches?: unknown })?.matches;
  if (!Array.isArray(rows)) return [];
  const out: ConfirmedMatch[] = [];
  for (const r of rows) {
    const o = r as Record<string, unknown>;
    const id = String(o.contactId ?? "");
    if (!validIds.has(id)) continue;
    const rawScore = Number(o.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(1, rawScore)) : 0.5;
    out.push({ contactId: id, score, reason: String(o.reason ?? "").trim() });
  }
  return out;
}

export async function confirmMatches(
  article: { title: string; summary: string; topics: string[] },
  candidates: Candidate[]
): Promise<ConfirmedMatch[]> {
  if (candidates.length === 0) return [];
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured — refusing to confirm matches");
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const user = [
    `Article: ${article.title}`,
    `Summary: ${article.summary}`,
    `Topics: ${article.topics.join(", ") || "n/a"}`,
    ``,
    `Contacts:`,
    ...candidates.map((c) => `- id=${c.contactId} | ${c.fullName} | ${c.currentTitle ?? "?"} @ ${c.currentCompany ?? "?"} | industry: ${c.industry ?? "?"} | ${c.headline ?? ""}`),
  ].join("\n");
  const res = await openrouterChat(
    "radar-match",
    {
      model,
      messages: [ { role: "system", content: CONFIRM_SYSTEM }, { role: "user", content: user } ],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 25_000 }
  );
  if (!res.ok) throw new Error(`fintech-radar confirm failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  return parseConfirmResponse(text, new Set(candidates.map((c) => c.contactId)));
}
