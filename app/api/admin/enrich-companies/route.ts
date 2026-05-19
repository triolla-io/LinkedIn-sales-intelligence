import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const POST = withTenant(async (_req, ctx) => {
  const me = await prisma.user.findUnique({
    where: { id: ctx.effectiveUserId },
    select: { role: true, orgId: true },
  });
  if (!me || (me.role !== "ADMIN" && me.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  await inngest.send({
    name: "companies.enrich-web" as const,
    data: { orgId: me.orgId },
  });

  return NextResponse.json({ ok: true });
});
