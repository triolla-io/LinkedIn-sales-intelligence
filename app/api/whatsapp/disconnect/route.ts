import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const POST = withTenant(async (_req: NextRequest, ctx) => {
  await waClient.disconnect(ctx.effectiveUserId);
  return NextResponse.json({ ok: true });
});
