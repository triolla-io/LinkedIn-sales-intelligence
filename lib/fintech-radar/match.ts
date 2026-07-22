import { Prisma } from "@/lib/generated/prisma/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";

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
    ...clevelTitleWhere(),
  };
  // When we have overlap signals, require at least one; otherwise fall back to plain C-level.
  return overlap.length > 0 ? { AND: [base, { OR: overlap }] } : base;
}
