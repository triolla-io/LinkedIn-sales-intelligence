import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/admin/audit";

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { org: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const impersonating = req.cookies.get("x-impersonation")?.value;
  if (impersonating) {
    const ctx = {
      user,
      org: user.org,
      impersonatedUserId: impersonating,
      effectiveUserId: impersonating,
    };
    await recordAudit(ctx, "impersonate.end", { targetUserId: impersonating });
  }

  const response = NextResponse.json({ stopped: true });
  response.cookies.set("x-impersonation", "", { maxAge: 0, path: "/" });
  return response;
}
