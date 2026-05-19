import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { inngest } from "@/inngest/client";

export async function POST(req: NextRequest) {
  return withTenant(async (_req, ctx) => {
    await inngest.send({ name: "sync.full", data: { userId: ctx.effectiveUserId } });
    return NextResponse.json({ ok: true, userId: ctx.effectiveUserId });
  })(req);
}
