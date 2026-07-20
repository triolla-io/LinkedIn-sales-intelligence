import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { computeJobChangeStats } from "@/lib/job-check/stats";

export const GET = withTenant(async (_req, ctx) => {
  const stats = await computeJobChangeStats(ctx.effectiveUserId, new Date());
  return NextResponse.json(stats);
});
