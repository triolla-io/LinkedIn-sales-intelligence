import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export function buildListsWhere(ownerId: string) {
  return { ownerId };
}

export function parseCreateBody(body: unknown): { name: string; contactIds?: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) return null;
  if (b.contactIds !== undefined && !Array.isArray(b.contactIds)) return null;
  return { name: b.name.trim(), contactIds: b.contactIds as string[] | undefined };
}

export const GET = withTenant(async (req: NextRequest, ctx) => {
  const contactId = req.nextUrl.searchParams.get("contactId") ?? undefined;

  if (contactId) {
    // Return only lists that contain this contact
    const memberships = await prisma.contactListMember.findMany({
      where: {
        contactId,
        list: { ownerId: ctx.effectiveUserId },
      },
      include: { list: true },
    });
    const lists = memberships.map((m) => ({ id: m.list.id, name: m.list.name, memberCount: 0 }));
    return NextResponse.json({ lists });
  }

  const lists = await prisma.contactList.findMany({
    where: buildListsWhere(ctx.effectiveUserId),
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      memberCount: l._count.members,
      createdAt: l.createdAt,
    })),
  });
});

export const POST = withTenant(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => null);
  const parsed = parseCreateBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const list = await prisma.contactList.create({
    data: {
      ownerId: ctx.effectiveUserId,
      name: parsed.name,
      ...(parsed.contactIds?.length
        ? {
            members: {
              createMany: {
                data: parsed.contactIds.map((contactId) => ({ contactId })),
                skipDuplicates: true,
              },
            },
          }
        : {}),
    },
  });

  return NextResponse.json({ list }, { status: 201 });
});
