import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { email: true, expiresAt: true, usedAt: true },
  });

  if (!invite) return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "This invite has expired" }, { status: 410 });

  return NextResponse.json({ email: invite.email });
}
