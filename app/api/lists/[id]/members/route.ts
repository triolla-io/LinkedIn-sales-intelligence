import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const POST = withTenant(async (req: NextRequest, ctx) => {
  // Path: /api/lists/{id}/members — ID is second-to-last segment
  const id = req.nextUrl.pathname.split("/").at(-2)!;

  const existing = await prisma.contactList.findFirst({ where: { id, ownerId: ctx.effectiveUserId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const add: string[] = Array.isArray(body.add) ? body.add : [];
  const remove: string[] = Array.isArray(body.remove) ? body.remove : [];

  if (add.length) {
    const owned = await prisma.contact.count({
      where: { id: { in: add }, ownerId: ctx.effectiveUserId },
    });
    if (owned !== add.length) {
      return NextResponse.json({ error: "One or more contacts not found" }, { status: 404 });
    }
  }

  await prisma.$transaction([
    ...(add.length
      ? [
          prisma.contactListMember.createMany({
            data: add.map((contactId) => ({ listId: id, contactId })),
            skipDuplicates: true,
          }),
        ]
      : []),
    ...(remove.length
      ? [
          prisma.contactListMember.deleteMany({
            where: { listId: id, contactId: { in: remove } },
          }),
        ]
      : []),
  ]);

  const memberCount = await prisma.contactListMember.count({ where: { listId: id } });
  return NextResponse.json({ ok: true, memberCount });
});
