import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  // Dynamic segment is read from the URL manually since withTenant wraps the whole handler
  const id = _req.nextUrl.pathname.split("/").at(-1)!;

  const contact = await prisma.contact.findFirst({
    where: { id, ownerId: ctx.effectiveUserId, removedAt: null },
    include: {
      messages: {
        orderBy: { sentAt: "desc" },
        take: 20,
        select: { id: true, body: true, sentAt: true, status: true },
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(contact);
});
