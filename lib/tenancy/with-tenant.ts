import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Organization, User } from "@/lib/generated/prisma/client";

export type TenantCtx = {
  user: User;
  org: Organization;
  impersonatedUserId: string | null;
  /** The user ID whose data this request operates on */
  effectiveUserId: string;
};

type Handler<T> = (req: NextRequest, ctx: TenantCtx) => Promise<T>;

export function withTenant<T>(handler: Handler<T>) {
  return async (req: NextRequest): Promise<Response> => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { org: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    const { org } = user;

    // Resolve impersonation
    const impersonationCookie = req.cookies.get("x-impersonation")?.value ?? null;
    let impersonatedUserId: string | null = null;
    let effectiveUserId = user.id;

    if (impersonationCookie) {
      if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Verify the target is in the same org
      const target = await prisma.user.findFirst({
        where: { id: impersonationCookie, orgId: org.id },
        select: { id: true },
      });

      if (!target) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      impersonatedUserId = target.id;
      effectiveUserId = target.id;
    }

    const ctx: TenantCtx = { user, org, impersonatedUserId, effectiveUserId };

    try {
      const result = await handler(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result);
    } catch (err) {
      console.error("[withTenant] handler error", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
