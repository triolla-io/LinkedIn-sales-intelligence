import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { encryptCookie } from "@/lib/linkedin/cookie-crypto";
import { publish } from "@/lib/linkedin/sse-bus";
import { z } from "zod";

const schema = z.object({ cookie: z.string().min(10) });

/**
 * POST /api/linkedin/connect/manual
 * Fallback when Browserless isn't available.
 * The user manually pastes their li_at cookie value.
 */
export const POST = withTenant(async (req, ctx) => {
  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid cookie value" }, { status: 400 });
  }

  const encrypted = encryptCookie(body.data.cookie);

  await prisma.linkedinSession.upsert({
    where: { userId: ctx.effectiveUserId },
    create: {
      userId: ctx.effectiveUserId,
      encryptedCookie: encrypted,
      status: "ACTIVE",
      lastValidatedAt: new Date(),
    },
    update: {
      encryptedCookie: encrypted,
      status: "ACTIVE",
      lastValidatedAt: new Date(),
    },
  });

  publish(ctx.effectiveUserId, { type: "linkedin:connected", data: {} });

  return NextResponse.json({ ok: true });
});
