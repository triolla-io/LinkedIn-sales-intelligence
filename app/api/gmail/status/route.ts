import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { hasGmailScope } from "@/lib/gmail/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const account = await prisma.account.findFirst({
    where: { userId: ctx.user.id, provider: "google" },
    select: { scope: true },
  });
  return NextResponse.json({ connected: hasGmailScope(account?.scope ?? null) });
});
