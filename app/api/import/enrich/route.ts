import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";

export const POST = withTenant(async (_req, ctx) => {
  const user = await prisma.user.findUnique({
    where: { id: ctx.effectiveUserId },
    select: { orgId: true },
  });

  await inngest.send({
    name: "companies.enrich-web" as const,
    data: { orgId: user?.orgId },
  });

  return NextResponse.json({ ok: true });
});
