import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/admin/audit";

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { org: true },
  });
  if (!actor) return NextResponse.json({ error: "User not found" }, { status: 401 });

  if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, orgId: actor.orgId },
  });
  if (!target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ctx = {
    user: actor,
    org: actor.org,
    impersonatedUserId: userId,
    effectiveUserId: userId,
  };
  await recordAudit(ctx, "impersonate.start", { targetUserId: userId });

  const response = NextResponse.json({ impersonating: userId });
  response.cookies.set("x-impersonation", userId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  });
  return response;
}
