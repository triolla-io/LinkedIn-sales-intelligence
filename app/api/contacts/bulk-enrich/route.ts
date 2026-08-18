import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { selectEnrichableContacts } from "@/lib/contacts/enrich-budget";
import { inngest } from "@/inngest/client";
import { z } from "zod";

const schema = z.object({ contactIds: z.array(z.string()).max(500) });

export async function POST(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    const parsed = schema.parse(await req.json());
    const { contactIds } = parsed;

    const sel = await selectEnrichableContacts({
      effectiveUserId: ctx.effectiveUserId,
      orgId: ctx.org.id,
      monthlyApolloBudget: ctx.org.monthlyApolloBudget,
      perUserMonthlyApolloCredits: ctx.org.perUserMonthlyApolloCredits,
      contactIds,
    });

    if ("budgetExhausted" in sel) {
      return NextResponse.json(
        { error: "BUDGET_EXHAUSTED", blockedBy: sel.blockedBy, creditsRemaining: 0 },
        { status: 402 }
      );
    }

    await inngest.send(
      sel.validIds.map((id) => ({
        name: "enrich.contact" as const,
        // ownerId keys the Inngest concurrency limit so a bulk fan-out can't
        // race past the per-user cap.
        data: { contactId: id, ownerId: ctx.effectiveUserId, actorId: ctx.user.id },
      }))
    );

    return NextResponse.json({
      queued: sel.validIds.length,
      skipped: sel.skipped,
      creditsRemaining: sel.creditsRemaining,
    });
  })(req);
}
