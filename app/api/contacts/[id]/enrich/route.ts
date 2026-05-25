import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { matchPerson } from "@/lib/apollo/client";
import { checkBudget, incrementBudget } from "@/lib/apollo/budget";
import { lookupContact } from "@/lib/hubspot/client";

/** Normalise a LinkedIn profile URL to its canonical /in/<slug> form. */
function normalizeLinkedinUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `https://www.linkedin.com${path}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req, ctx) => {
    // ── 1. Load contact ────────────────────────────────────────────────────
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: ctx.effectiveUserId, removedAt: null },
    });
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── 2. Budget check ───────────────────────────────────────────────────
    const budget = await checkBudget(ctx.org.id, ctx.org.monthlyApolloBudget);
    if (!budget.allowed) {
      return NextResponse.json(
        { error: "BUDGET_EXHAUSTED", creditsRemaining: 0 },
        { status: 402 }
      );
    }

    // ── 3. HubSpot lookup — free, no budget cost ─────────────────────────
    const hubspotResult = await lookupContact({
      linkedinUrl: contact.linkedinUrl,
      fullName: contact.fullName,
      company: contact.currentCompany ?? undefined,
    });

    if (hubspotResult?.email || hubspotResult?.phone) {
      const protected_ = new Set(contact.manualFields as string[]);
      const patch: Record<string, unknown> = {
        enrichedAt: new Date(),
        enrichmentSource: "hubspot",
        enrichmentRanAt: new Date(),
        enrichmentError: null,
      };
      if (!protected_.has("email") && hubspotResult.email) patch.email = hubspotResult.email;
      if (!protected_.has("phone") && hubspotResult.phone) patch.phone = hubspotResult.phone;
      await prisma.contact.update({ where: { id }, data: patch });

      return NextResponse.json({
        source: "hubspot",
        email: hubspotResult.email ?? null,
        phone: hubspotResult.phone ?? null,
        companySize: null,
        currentCompany: null,
        industry: null,
        mobilePending: false,
        creditsRemaining: budget.creditsRemaining,
      });
    }

    // ── 4. PersonEnrichment cache lookup ──────────────────────────────────
    const normalizedUrl = contact.linkedinUrl ? normalizeLinkedinUrl(contact.linkedinUrl) : "";
    const cached = normalizedUrl
      ? await prisma.personEnrichment.findUnique({
          where: {
            orgId_linkedinUrlNormalized: {
              orgId: ctx.org.id,
              linkedinUrlNormalized: normalizedUrl,
            },
          },
        })
      : null;

    if (cached && (cached.email || cached.phone)) {
      const protected_ = new Set(contact.manualFields as string[]);
      const patch: Record<string, unknown> = {
        enrichedAt: new Date(),
        enrichmentSource: "cache",
        enrichmentRanAt: new Date(),
        enrichmentError: null,
      };
      if (!protected_.has("email") && cached.email) patch.email = cached.email;
      if (!protected_.has("phone") && cached.phone) patch.phone = cached.phone;
      if (cached.companySize) patch.companySize = cached.companySize;
      if (!protected_.has("currentCompany") && cached.currentCompany && !contact.currentCompany)
        patch.currentCompany = cached.currentCompany;
      if (!protected_.has("industry") && cached.industry && !contact.industry)
        patch.industry = cached.industry;

      await prisma.contact.update({ where: { id }, data: patch });

      return NextResponse.json({
        source: "cache",
        email: cached.email ?? null,
        phone: cached.phone ?? null,
        companySize: cached.companySize ?? null,
        currentCompany: cached.currentCompany ?? null,
        industry: cached.industry ?? null,
        enrichedByContactId: cached.enrichedByContactId ?? null,
        mobilePending: false,
        creditsRemaining: budget.creditsRemaining,
      });
    }

    // ── 4. Cache miss — call Apollo inline ────────────────────────────────
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
        where: { id },
        data: {
          enrichmentRanAt: new Date(),
          enrichmentError: errorMessage,
        },
      });
      return NextResponse.json(
        { error: "APOLLO_ERROR", detail: errorMessage },
        { status: 502 }
      );
    }

    // ── 5. Save results to Contact ────────────────────────────────────────
    const { email, phone, companySize, currentCompany, industry, raw: rawUnknown } = apolloResult;
    const raw = rawUnknown != null ? (rawUnknown as Prisma.InputJsonValue) : Prisma.JsonNull;
    const protected_ = new Set(contact.manualFields as string[]);

    const patch: Record<string, unknown> = {
      enrichedAt: new Date(),
      enrichmentSource: "apollo",
      enrichmentRanAt: new Date(),
      enrichmentError: null,
      enrichmentLog: raw,
    };
    if (!protected_.has("email") && email) patch.email = email;
    if (!protected_.has("phone") && phone) patch.phone = phone;
    if (companySize) patch.companySize = companySize;
    if (!protected_.has("currentCompany") && currentCompany && !contact.currentCompany)
      patch.currentCompany = currentCompany;
    if (!protected_.has("industry") && industry && !contact.industry)
      patch.industry = industry;

    // ── 6. Upsert PersonEnrichment cache + increment budget ───────────────
    const cacheOps = normalizedUrl
      ? [
          prisma.personEnrichment.upsert({
            where: {
              orgId_linkedinUrlNormalized: {
                orgId: ctx.org.id,
                linkedinUrlNormalized: normalizedUrl,
              },
            },
            create: {
              orgId: ctx.org.id,
              linkedinUrlNormalized: normalizedUrl,
              email: email ?? null,
              phone: phone ?? null,
              companySize: companySize ?? null,
              currentCompany: currentCompany ?? null,
              industry: industry ?? null,
              rawResponse: raw,
              enrichedByContactId: id,
            },
            update: {
              email: email ?? null,
              phone: phone ?? null,
              companySize: companySize ?? null,
              currentCompany: currentCompany ?? null,
              industry: industry ?? null,
              rawResponse: raw,
              enrichedByContactId: id,
            },
          }),
        ]
      : [];
    await prisma.$transaction([prisma.contact.update({ where: { id }, data: patch }), ...cacheOps]);

    await incrementBudget(ctx.org.id);

    const newBudget = await checkBudget(ctx.org.id, ctx.org.monthlyApolloBudget);

    return NextResponse.json({
      source: "apollo",
      email: email ?? null,
      phone: phone ?? null,
      companySize: companySize ?? null,
      currentCompany: currentCompany ?? null,
      industry: industry ?? null,
      enrichmentLog: rawUnknown ?? null,
      enrichmentRanAt: new Date().toISOString(),
      mobilePending: false,
      creditsRemaining: newBudget.creditsRemaining,
    });
  })(req);
}
