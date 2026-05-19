import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { token } = await req.json() as { token: string };
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const invite = await prisma.invite.findUnique({
    where: { token },
    select: { id: true, orgId: true, email: true, expiresAt: true, usedAt: true },
  });

  if (!invite) return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  if (invite.usedAt) return NextResponse.json({ error: "Invite already used" }, { status: 410 });
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: "Invite expired" }, { status: 410 });

  // The signed-in user should match the invite email
  const signedInEmail = session.user.email?.toLowerCase();
  if (signedInEmail && invite.email.toLowerCase() !== signedInEmail) {
    return NextResponse.json(
      { error: `Please sign in with ${invite.email} to accept this invite` },
      { status: 403 },
    );
  }

  // Move the user into the org
  await prisma.$transaction([
    prisma.user.update({
      where: { id: session.user.id },
      data: { orgId: invite.orgId },
    }),
    prisma.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
