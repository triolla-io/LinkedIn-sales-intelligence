import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { z } from "zod";

const schema = z.object({ contactIds: z.array(z.string()).max(500) });

export async function POST(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    const parsed = schema.parse(await req.json());
    const { contactIds } = parsed;

    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, ownerId: ctx.effectiveUserId },
      select: { id: true },
    });

    const month = new Date().toISOString().slice(0, 7);
    const spend = await prisma.enrichmentSpend.findUnique({
      where: { orgId_month: { orgId: ctx.org.id, month } },
    });
    const creditsUsed = spend?.credits ?? 0;
    const creditsRemaining = ctx.org.monthlyApolloBudget - creditsUsed;

    if (creditsRemaining <= 0) {
      return NextResponse.json({ error: "BUDGET_EXHAUSTED", creditsRemaining: 0 }, { status: 402 });
    }

    const validIds = contacts.map((c) => c.id).slice(0, creditsRemaining);

    await inngest.send(
      validIds.map((id) => ({ name: "enrich.contact" as const, data: { contactId: id, actorId: ctx.user.id } }))
    );

    return NextResponse.json({ queued: validIds.length, creditsRemaining: creditsRemaining - validIds.length });
  })(req);
}
