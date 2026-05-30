import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/extension/token";

export const POST = withTenant(async (_req, ctx) => {
  const existing = await prisma.extensionSession.findUnique({
    where: { userId: ctx.user.id },
  });
  if (existing && !existing.revokedAt) {
    return NextResponse.json(
      { error: "session_exists", message: "Revoke the existing session first" },
      { status: 409 }
    );
  }

  const { raw, hash, prefix } = generateToken();
  const session = await prisma.extensionSession.upsert({
    where: { userId: ctx.user.id },
    update: { tokenHash: hash, tokenPrefix: prefix, revokedAt: null, lastSeenAt: null },
    create: { userId: ctx.user.id, tokenHash: hash, tokenPrefix: prefix },
  });

  return NextResponse.json({ id: session.id, token: raw, prefix });
});

export const GET = withTenant(async (_req, ctx) => {
  const s = await prisma.extensionSession.findUnique({
    where: { userId: ctx.user.id },
    select: { id: true, tokenPrefix: true, lastSeenAt: true, version: true, revokedAt: true, createdAt: true },
  });
  return NextResponse.json({ session: s ?? null });
});
