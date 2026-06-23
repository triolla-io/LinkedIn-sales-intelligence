import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { sanitizeSignature } from "@/lib/email/sanitize-signature";
import { z } from "zod";

const patchSchema = z.object({ signature: z.string() });

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const user = await prisma.user.findUnique({
    where: { id: ctx.effectiveUserId },
    select: { emailSignature: true },
  });
  return NextResponse.json({ signature: user?.emailSignature ?? null });
});

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const { signature } = patchSchema.parse(await req.json());
  const clean = sanitizeSignature(signature);
  await prisma.user.update({
    where: { id: ctx.effectiveUserId },
    data: { emailSignature: clean.length > 0 ? clean : null },
  });
  return NextResponse.json({ signature: clean.length > 0 ? clean : null });
});
