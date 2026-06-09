import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const job = await prisma.importJob.findFirst({
    where: {
      ownerId: ctx.effectiveUserId,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      stage: true,
      total: true,
      processed: true,
      fileName: true,
    },
  });
  return NextResponse.json({ job });
});
