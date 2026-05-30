import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const DELETE = withTenant(async (req, ctx) => {
  const url = new URL(req.url);
  const id = url.pathname.split("/").pop()!;
  const updated = await prisma.extensionSession.updateMany({
    where: { id, userId: ctx.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
