import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { enrichContactCore } from "@/lib/enrichment/enrich-contact-core";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (_req, ctx) => {
    // ── 1. Load contact (tenant-scoped) ─────────────────────────────────────
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: ctx.effectiveUserId, removedAt: null },
    });
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── 2. Run the shared enrichment cascade ────────────────────────────────
    const result = await enrichContactCore({
      contact,
      orgId: ctx.org.id,
      monthlyApolloBudget: ctx.org.monthlyApolloBudget,
    });

    if (result.status === "budget_exhausted") {
      return NextResponse.json({ error: "BUDGET_EXHAUSTED", creditsRemaining: 0 }, { status: 402 });
    }
    if (result.status === "apollo_error") {
      return NextResponse.json({ error: "APOLLO_ERROR", detail: result.error }, { status: 502 });
    }

    return NextResponse.json({
      source: result.source,
      email: result.email,
      phone: result.phone,
      companySize: result.companySize,
      currentCompany: result.currentCompany,
      industry: result.industry,
      enrichedByContactId: result.enrichedByContactId,
      enrichmentLog: result.enrichmentLog,
      enrichmentRanAt: result.enrichmentRanAt,
      mobilePending: false,
      creditsRemaining: result.creditsRemaining,
    });
  })(req);
}
