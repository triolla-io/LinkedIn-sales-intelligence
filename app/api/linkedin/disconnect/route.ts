import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/linkedin/sse-bus";

export const POST = withTenant(async (_req, ctx) => {
  await prisma.linkedinSession.updateMany({
    where: { userId: ctx.effectiveUserId },
    data: { status: "DISCONNECTED", encryptedCookie: "" },
  });

  publish(ctx.effectiveUserId, { type: "linkedin:disconnected", data: {} });

  return NextResponse.json({ ok: true });
});
