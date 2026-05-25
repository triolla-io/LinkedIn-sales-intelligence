import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const listId = req.nextUrl.pathname.split("/").at(-2)!;

  const list = await prisma.contactList.findFirst({
    where: { id: listId, ownerId: ctx.effectiveUserId },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [total, withEmail] = await Promise.all([
    prisma.contactListMember.count({ where: { listId } }),
    prisma.contact.count({ where: { lists: { some: { listId } }, email: { not: null } } }),
  ]);

  return NextResponse.json({ total, withEmail });
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const listId = req.nextUrl.pathname.split("/").at(-2)!;

  const list = await prisma.contactList.findFirst({
    where: { id: listId, ownerId: ctx.effectiveUserId },
  });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const month = new Date().toISOString().slice(0, 7);
  const spend = await prisma.enrichmentSpend.findUnique({
    where: { orgId_month: { orgId: ctx.org.id, month } },
  });
  const creditsUsed = spend?.credits ?? 0;
  const creditsRemaining = ctx.org.monthlyApolloBudget - creditsUsed;

  if (creditsRemaining <= 0) {
    return NextResponse.json({ error: "BUDGET_EXHAUSTED", creditsRemaining: 0 }, { status: 402 });
  }

  const unenriched = await prisma.contact.findMany({
    where: {
      ownerId: ctx.effectiveUserId,
      lists: { some: { listId } },
      email: null,
    },
    select: { id: true, linkedinUrn: true },
  });

  // ── Cross-user sharing: batch lookup to avoid N+1 queries ────────────────────
  const urnsToCheck = unenriched.map((c) => c.linkedinUrn);

  const sharedContacts = await prisma.contact.findMany({
    where: {
      linkedinUrn: { in: urnsToCheck },
      NOT: { ownerId: ctx.effectiveUserId },
      OR: [{ email: { not: null } }, { phone: { not: null } }],
    },
    select: { linkedinUrn: true, email: true, phone: true },
  });

  const sharedMap = new Map(sharedContacts.map((sc) => [sc.linkedinUrn, sc]));

  const toQueue: string[] = [];
  let sharedCount = 0;

  const sharedUpdates = [];
  for (const c of unenriched) {
    const shared = sharedMap.get(c.linkedinUrn);
    if (shared?.email || shared?.phone) {
      sharedUpdates.push(
        prisma.contact.update({
          where: { id: c.id },
          data: {
            ...(shared.email ? { email: shared.email } : {}),
            ...(shared.phone ? { phone: shared.phone } : {}),
            enrichmentSource: "shared",
            enrichedAt: new Date(),
          },
        })
      );
      sharedCount++;
    } else {
      toQueue.push(c.id);
    }
  }

  if (sharedUpdates.length > 0) {
    await prisma.$transaction(sharedUpdates);
  }

  // ── Queue remaining contacts for Apollo (respecting budget) ──────────────────
  const toEnrich = toQueue.slice(0, creditsRemaining);

  if (toEnrich.length > 0) {
    try {
      await inngest.send(
        toEnrich.map((id) => ({
          name: "enrich.contact" as const,
          data: { contactId: id, actorId: ctx.user.id },
        }))
      );
    } catch {
      return NextResponse.json({ error: "QUEUE_FAILED" }, { status: 502 });
    }
  }

  return NextResponse.json({
    queued: toEnrich.length,
    shared: sharedCount,
    skipped: toQueue.length - toEnrich.length,
    creditsRemaining: creditsRemaining - toEnrich.length,
  });
});
