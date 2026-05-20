import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const data = await waClient.status(ctx.effectiveUserId);
  return NextResponse.json(data);
});
