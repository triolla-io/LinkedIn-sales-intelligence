import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { matchPerson } from "@/lib/apollo/client";
import { checkEnrichmentBudget, incrementBudget, enrichmentCreditCost } from "@/lib/apollo/budget";
import { lookupContact } from "@/lib/hubspot/client";
import { inngest } from "@/inngest/client";
import type { PropagatableValues } from "@/lib/enrichment/propagate";

// A cached row with no email/phone is a prior Apollo no-match. Respect it for this
// many days before retrying, so repeated bulk-enrich clicks don't re-charge ~1 credit
// each for the same unmatchable person. Mirrors the 30-day company-enrichment window.
const NEGATIVE_CACHE_DAYS = 30;

/** Normalise a LinkedIn profile URL to its canonical /in/<slug> form.
 *  Returns empty string if the URL has no real profile slug. */
export function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // Must look like /in/<slug> — reject bare /in or shorter paths
    if (!/^\/in\/.+/.test(path)) return "";
    return `https://www.linkedin.com${path}`;
  } catch {
    return "";
  }
}

/** The subset of Contact fields the enrichment cascade reads. */
export interface EnrichableContact {
  id: string;
  fullName: string;
  linkedinUrl: string;
  currentCompany: string | null;
  industry: string | null;
  manualFields: unknown;
}

export type EnrichmentResult =
  | { status: "budget_exhausted"; blockedBy: "org" | "user" }
  | { status: "apollo_error"; error: string }
  | {
      status: "ok";
      source: "hubspot" | "cache" | "apollo";
      email: string | null;
      phone: string | null;
      companySize: number | null;
      currentCompany: string | null;
      industry: string | null;
      enrichmentLog: unknown | null;
      enrichedByContactId: string | null;
      enrichmentRanAt: string;
      creditsRemaining: number;
    };

/** Fan the enriched values out to sibling contacts in the same org (background). */
async function emitPropagation(
  orgId: string,
  linkedinUrlNormalized: string,
  sourceContactId: string,
  values: PropagatableValues
): Promise<void> {
  const hasValue = Object.values(values).some((v) => v != null && v !== "");
  if (!linkedinUrlNormalized || !hasValue) return;
  await inngest.send({
    name: "enrichment.propagate" as const,
    data: { orgId, linkedinUrlNormalized, sourceContactId, values },
  });
}

/**
 * Single source of truth for enriching one contact.
 *
 * Cascade (stops at first hit): HubSpot (free) → PersonEnrichment cache (free)
 * → Apollo (paid). Apollo results are written back into the cache so future
 * lookups — single or bulk — reuse them for free.
 *
 * Writes results (and any error) to the Contact row. Both the synchronous
 * drawer route and the bulk/background Inngest function call this so they can
 * never drift apart again.
 */
export async function enrichContactCore(opts: {
  contact: EnrichableContact;
  orgId: string;
  /** The contact's owner — credits are charged to them, not to an acting admin. */
  ownerId: string;
  monthlyApolloBudget: number;
  perUserMonthlyApolloCredits: number;
}): Promise<EnrichmentResult> {
  const { contact, orgId, ownerId, monthlyApolloBudget, perUserMonthlyApolloCredits } = opts;
  const protectedFields = new Set((contact.manualFields as string[]) ?? []);
  const ranAt = new Date();
  const normalizedUrl = contact.linkedinUrl ? normalizeLinkedinUrl(contact.linkedinUrl) : "";

  // ── 1. Budget check ─────────────────────────────────────────────────────
  const budget = await checkEnrichmentBudget({
    orgId,
    userId: ownerId,
    orgLimit: monthlyApolloBudget,
    userLimit: perUserMonthlyApolloCredits,
  });
  if (budget.blockedBy) {
    return { status: "budget_exhausted", blockedBy: budget.blockedBy };
  }

  // ── 2. HubSpot lookup — free, no budget cost ────────────────────────────
  const hubspotResult = await lookupContact({
    linkedinUrl: contact.linkedinUrl,
    fullName: contact.fullName,
    company: contact.currentCompany ?? undefined,
  });

  if (hubspotResult?.email || hubspotResult?.phone) {
    const patch: Record<string, unknown> = {
      enrichedAt: ranAt,
      enrichmentSource: "hubspot",
      enrichmentRanAt: ranAt,
      enrichmentError: null,
    };
    if (!protectedFields.has("email") && hubspotResult.email) patch.email = hubspotResult.email;
    if (!protectedFields.has("phone") && hubspotResult.phone) patch.phone = hubspotResult.phone;
    await prisma.contact.update({ where: { id: contact.id }, data: patch });

    await emitPropagation(orgId, normalizedUrl, contact.id, {
      email: hubspotResult.email ?? null,
      phone: hubspotResult.phone ?? null,
    });
    return {
      status: "ok",
      source: "hubspot",
      email: hubspotResult.email ?? null,
      phone: hubspotResult.phone ?? null,
      companySize: null,
      currentCompany: null,
      industry: null,
      enrichmentLog: null,
      enrichedByContactId: null,
      enrichmentRanAt: ranAt.toISOString(),
      creditsRemaining: budget.creditsRemaining,
    };
  }

  // ── 3. PersonEnrichment cache lookup — free ─────────────────────────────
  const cached = normalizedUrl
    ? await prisma.personEnrichment.findUnique({
        where: { orgId_linkedinUrlNormalized: { orgId, linkedinUrlNormalized: normalizedUrl } },
      })
    : null;

  if (cached && (cached.email || cached.phone)) {
    const patch: Record<string, unknown> = {
      enrichedAt: ranAt,
      enrichmentSource: "cache",
      enrichmentRanAt: ranAt,
      enrichmentError: null,
    };
    if (!protectedFields.has("email") && cached.email) patch.email = cached.email;
    if (!protectedFields.has("phone") && cached.phone) patch.phone = cached.phone;
    if (cached.companySize) patch.companySize = cached.companySize;
    if (!protectedFields.has("currentCompany") && cached.currentCompany && !contact.currentCompany)
      patch.currentCompany = cached.currentCompany;
    if (!protectedFields.has("industry") && cached.industry && !contact.industry)
      patch.industry = cached.industry;

    await prisma.contact.update({ where: { id: contact.id }, data: patch });

    await emitPropagation(orgId, normalizedUrl, contact.id, {
      email: cached.email,
      phone: cached.phone,
      companySize: cached.companySize,
      currentCompany: cached.currentCompany,
      industry: cached.industry,
    });
    return {
      status: "ok",
      source: "cache",
      email: cached.email ?? null,
      phone: cached.phone ?? null,
      companySize: cached.companySize ?? null,
      currentCompany: cached.currentCompany ?? null,
      industry: cached.industry ?? null,
      enrichmentLog: null,
      enrichedByContactId: cached.enrichedByContactId ?? null,
      enrichmentRanAt: ranAt.toISOString(),
      creditsRemaining: budget.creditsRemaining,
    };
  }

  // ── 3b. Negative cache — a row exists but carries no contact info. Apollo already
  // attempted this person and found no email/phone. Respect it for NEGATIVE_CACHE_DAYS
  // so re-enriching the same list doesn't re-charge a credit per unmatchable contact.
  // After the window, fall through and retry (contact info may have appeared since).
  if (cached && !cached.email && !cached.phone) {
    const ageMs = ranAt.getTime() - cached.updatedAt.getTime();
    if (ageMs < NEGATIVE_CACHE_DAYS * 24 * 60 * 60 * 1000) {
      const patch: Record<string, unknown> = {
        enrichedAt: ranAt,
        enrichmentSource: "cache",
        enrichmentRanAt: ranAt,
        enrichmentError: null,
      };
      if (cached.companySize) patch.companySize = cached.companySize;
      if (!protectedFields.has("currentCompany") && cached.currentCompany && !contact.currentCompany)
        patch.currentCompany = cached.currentCompany;
      if (!protectedFields.has("industry") && cached.industry && !contact.industry)
        patch.industry = cached.industry;
      await prisma.contact.update({ where: { id: contact.id }, data: patch });
      return {
        status: "ok",
        source: "cache",
        email: null,
        phone: null,
        companySize: cached.companySize ?? null,
        currentCompany: cached.currentCompany ?? null,
        industry: cached.industry ?? null,
        enrichmentLog: null,
        enrichedByContactId: cached.enrichedByContactId ?? null,
        enrichmentRanAt: ranAt.toISOString(),
        creditsRemaining: budget.creditsRemaining,
      };
    }
  }

  // ── 4. Cache miss — call Apollo (paid) ──────────────────────────────────
  let apolloResult: Awaited<ReturnType<typeof matchPerson>>;
  try {
    apolloResult = await matchPerson({
      name: contact.fullName,
      company: contact.currentCompany ?? undefined,
      linkedinUrl: contact.linkedinUrl ?? undefined,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.contact.update({
      where: { id: contact.id },
      data: { enrichmentRanAt: ranAt, enrichmentError: errorMessage },
    });
    return { status: "apollo_error", error: errorMessage };
  }

  // ── 5. Save Apollo results + prime the cache ────────────────────────────
  const { email, phone, companySize, currentCompany, industry, raw: rawUnknown } = apolloResult;
  const raw = rawUnknown != null ? (rawUnknown as Prisma.InputJsonValue) : Prisma.JsonNull;

  const patch: Record<string, unknown> = {
    enrichedAt: ranAt,
    enrichmentSource: "apollo",
    enrichmentRanAt: ranAt,
    enrichmentError: null,
    enrichmentLog: raw,
  };
  if (!protectedFields.has("email") && email) patch.email = email;
  if (!protectedFields.has("phone") && phone) patch.phone = phone;
  if (companySize) patch.companySize = companySize;
  if (!protectedFields.has("currentCompany") && currentCompany && !contact.currentCompany)
    patch.currentCompany = currentCompany;
  if (!protectedFields.has("industry") && industry && !contact.industry)
    patch.industry = industry;

  const cacheOps = normalizedUrl
    ? [
        prisma.personEnrichment.upsert({
          where: { orgId_linkedinUrlNormalized: { orgId, linkedinUrlNormalized: normalizedUrl } },
          create: {
            orgId,
            linkedinUrlNormalized: normalizedUrl,
            email: email ?? null,
            phone: phone ?? null,
            companySize: companySize ?? null,
            currentCompany: currentCompany ?? null,
            industry: industry ?? null,
            rawResponse: raw,
            enrichedByContactId: contact.id,
          },
          update: {
            email: email ?? null,
            phone: phone ?? null,
            companySize: companySize ?? null,
            currentCompany: currentCompany ?? null,
            industry: industry ?? null,
            rawResponse: raw,
            enrichedByContactId: contact.id,
          },
        }),
      ]
    : [];
  await prisma.$transaction([prisma.contact.update({ where: { id: contact.id }, data: patch }), ...cacheOps]);

  // Charge the ACTUAL credits Apollo billed (email + waterfall mobile), not a
  // flat 1 — otherwise the monthly budget silently allows ~9x its real value.
  await incrementBudget({ orgId, userId: ownerId, credits: enrichmentCreditCost({ email, phone }) });
  const newBudget = await checkEnrichmentBudget({
    orgId,
    userId: ownerId,
    orgLimit: monthlyApolloBudget,
    userLimit: perUserMonthlyApolloCredits,
  });

  await emitPropagation(orgId, normalizedUrl, contact.id, {
    email,
    phone,
    companySize,
    currentCompany,
    industry,
  });
  return {
    status: "ok",
    source: "apollo",
    email: email ?? null,
    phone: phone ?? null,
    companySize: companySize ?? null,
    currentCompany: currentCompany ?? null,
    industry: industry ?? null,
    enrichmentLog: rawUnknown ?? null,
    enrichedByContactId: null,
    enrichmentRanAt: ranAt.toISOString(),
    creditsRemaining: newBudget.creditsRemaining,
  };
}
