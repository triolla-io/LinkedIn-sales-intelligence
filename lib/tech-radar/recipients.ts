/**
 * Who at the company gets this opportunity.
 *
 * Materially simpler than lib/fintech-radar/match.ts, and that simplicity is the
 * payoff of inverting the pipeline: the company is known up front, so there is no
 * need to guess which contacts in the whole database an article might suit. No
 * industry keyword maps, no headline matching — just "senior contacts at this
 * company", then one LLM call to pick who fits THIS technology.
 *
 * Seniority comes from lib/company-signals/clevel.ts (the wider VP / head-of
 * tier), which already handles the Hebrew case where סמנכ"ל contains מנכ"ל.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { seniorTitleWhere } from "@/lib/company-signals/clevel";
import { openrouterChat } from "@/lib/openrouter/client";
import { parseJsonLoose, clampScore } from "@/lib/tech-radar/parse";
import {
  MAX_RECIPIENTS_PER_OPPORTUNITY,
  OR_FEATURE,
  type RankedRecipient,
  type RecipientCandidate,
} from "@/lib/tech-radar/types";

export type RecipientCompany = { companyId: string | null; name: string; aliases?: string[] };

/**
 * "Contacts at this company", with NO seniority filter.
 *
 * Split out from buildRecipientWhere so that "at this company" has exactly one
 * definition. The alias handling below is the load-bearing part — duplicating it
 * for a second caller is how two employer matchers drift apart.
 *
 * Accepts one owner or many, so the caller can cover a whole org in a single query.
 */
export function companyMatchWhere(
  ownerId: string | string[],
  company: RecipientCompany
): Prisma.ContactWhereInput {
  const owner: Prisma.ContactWhereInput["ownerId"] = Array.isArray(ownerId) ? { in: ownerId } : ownerId;
  // Prefer the resolved company link — it is exact, so no name matching is needed.
  if (company.companyId) {
    return {
      ownerId: owner,
      removedAt: null,
      companyId: company.companyId,
    };
  }

  // Otherwise match the canonical name OR any alias. A holding company's people write
  // their employer many ways: the live Delek Group run matched 1 contact of 7 because
  // the Head of Digital and the CIDO write "Delek" and "Delek US Holdings".
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of [company.name, ...(company.aliases ?? [])]) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return {
    ownerId: owner,
    removedAt: null,
    OR: names.map((name) => ({ currentCompany: { contains: name, mode: "insensitive" as const } })),
  };
}

/** Senior contacts at this company — the company match plus the seniority gate. */
export function buildRecipientWhere(
  ownerId: string | string[],
  company: RecipientCompany
): Prisma.ContactWhereInput {
  const base = companyMatchWhere(ownerId, company);
  // seniorTitleWhere() emits its own OR. When the base already has one (the
  // name-matching branch), the two would be sibling ORs and the second would
  // overwrite the first, silently dropping the seniority filter — so it has to be
  // nested under AND there, and can be spread only when the base has no OR.
  return base.OR ? { ...base, AND: [seniorTitleWhere()] } : { ...base, ...seniorTitleWhere() };
}

const SYSTEM = `You pick which senior people at ONE company should hear about ONE specific new technology.

Match by what the person is responsible for. A payments launch goes to whoever owns payments and to the CEO; it does not go to the head of HR. A data-infrastructure launch goes to the CTO or VP Engineering.

Be selective. Omit anyone who has no concrete role-based connection to this technology — returning fewer is correct and expected. Never invent contact ids.

Return strict JSON only — no prose, no fences:
{"recipients":[{"contactId":"<id>","score":0.0-1.0,"reason":"one short sentence in Hebrew"}]}`;

function userPrompt(
  item: { technology: string; title: string; summary: string },
  candidates: RecipientCandidate[]
): string {
  return [
    `New technology: ${item.technology}`,
    `Headline: ${item.title}`,
    `What it is: ${item.summary}`,
    ``,
    `People:`,
    ...candidates.map(
      (c) => `- id=${c.contactId} | ${c.fullName} | ${c.currentTitle ?? "?"} | ${c.headline ?? ""}`
    ),
  ].join("\n");
}

export function parseRankResponse(text: string, validIds: Set<string>): RankedRecipient[] {
  const parsed = parseJsonLoose<{ recipients?: unknown }>(text);
  const rows = Array.isArray(parsed?.recipients) ? parsed.recipients : [];
  const seen = new Set<string>();
  const out: RankedRecipient[] = [];

  for (const row of rows) {
    const o = row as Record<string, unknown>;
    const contactId = String(o.contactId ?? "").trim();
    // A hallucinated id would create a draft aimed at nobody.
    if (!contactId || !validIds.has(contactId) || seen.has(contactId)) continue;
    const reason = String(o.reason ?? "").trim();
    if (!reason) continue;
    seen.add(contactId);
    out.push({ contactId, score: clampScore(o.score), reason });
  }
  return out;
}

export async function rankRecipients(
  item: { technology: string; title: string; summary: string },
  candidates: RecipientCandidate[]
): Promise<RankedRecipient[]> {
  if (candidates.length === 0) return [];
  const model =
    process.env.TECH_RADAR_MODEL ?? process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const res = await openrouterChat(
    OR_FEATURE.recipients,
    {
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(item, candidates) },
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" },
    },
    { timeoutMs: 25_000 }
  );
  if (!res.ok) throw new Error(`tech-radar recipients failed: HTTP ${res.status}`);
  const text: string = res.data.choices?.[0]?.message?.content ?? "";
  const ranked = parseRankResponse(text, new Set(candidates.map((c) => c.contactId)));
  return ranked
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.contactId < b.contactId ? -1 : 1))
    .slice(0, MAX_RECIPIENTS_PER_OPPORTUNITY);
}
