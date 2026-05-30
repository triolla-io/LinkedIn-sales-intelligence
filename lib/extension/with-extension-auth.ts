import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/extension/token";
import type { User } from "@/lib/generated/prisma/client";

export type ExtensionCtx = {
  user: User;
  sessionId: string;
};

type Handler<T> = (req: NextRequest, ctx: ExtensionCtx) => Promise<T>;

export function withExtensionAuth<T>(handler: Handler<T>) {
  return async (req: NextRequest): Promise<Response> => {
    const header = req.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const raw = header.slice(7).trim();
    if (!raw) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const session = await prisma.extensionSession.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: true },
    });
    if (!session || session.revokedAt) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const result = await handler(req, { user: session.user, sessionId: session.id });
      if (result instanceof Response) return result;
      return NextResponse.json(result);
    } catch (err) {
      console.error("[withExtensionAuth] error", err);
      const detail = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: "Internal server error", detail }, { status: 500 });
    }
  };
}
