import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant(async (req, ctx) => {
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: ctx.effectiveUserId },
    });
    if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const month = new Date().toISOString().slice(0, 7);
    const spend = await prisma.enrichmentSpend.findUnique({
      where: { orgId_month: { orgId: ctx.org.id, month } },
    });
    const creditsUsed = spend?.credits ?? 0;
    if (creditsUsed >= ctx.org.monthlyApolloBudget) {
      return NextResponse.json({ error: "BUDGET_EXHAUSTED", creditsRemaining: 0 }, { status: 402 });
    }

    await inngest.send({ name: "enrich.contact", data: { contactId: id, actorId: ctx.user.id } });
    return NextResponse.json({ jobId: "queued", creditsRemaining: ctx.org.monthlyApolloBudget - creditsUsed });
  })(req);
}
