import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const linkedinSession = await prisma.linkedinSession.findUnique({
    where: { userId: session.user.id },
    select: { status: true, lastValidatedAt: true, updatedAt: true },
  });

  return NextResponse.json({
    status: linkedinSession?.status ?? "DISCONNECTED",
    lastValidatedAt: linkedinSession?.lastValidatedAt?.toISOString() ?? null,
    updatedAt: linkedinSession?.updatedAt?.toISOString() ?? null,
  });
}
