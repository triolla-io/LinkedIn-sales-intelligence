import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  return withTenant(async (req, ctx) => {
    if (ctx.user.role !== "ADMIN" && ctx.user.role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentMonth = new Date().toISOString().slice(0, 7);

    const users = await prisma.user.findMany({
      where: { orgId: ctx.org.id },
      include: {
        _count: { select: { contacts: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const syncStats = await prisma.contact.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: users.map((u) => u.id) }, removedAt: null },
      _max: { lastSyncedAt: true },
    });
    const syncMap = Object.fromEntries(syncStats.map((s) => [s.ownerId, s._max.lastSyncedAt]));

    const spend = await prisma.enrichmentSpend.findUnique({
      where: { orgId_month: { orgId: ctx.org.id, month: currentMonth } },
    });

    return NextResponse.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        contactCount: u._count.contacts,
        lastSyncedAt: syncMap[u.id] ?? null,
        creditsConsumed: spend?.credits ?? 0,
      }))
    );
  })(req);
}
