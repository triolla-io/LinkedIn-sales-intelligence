import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptCookie } from "@/lib/linkedin/cookie-crypto";
import { publish } from "@/lib/linkedin/sse-bus";

/**
 * POST /api/linkedin/connect/complete
 * Called by the Browserless webhook once the user has logged in.
 * Body: { userId: string; cookies: Array<{ name: string; value: string }> }
 *
 * In production, protect this endpoint with a shared secret header
 * (e.g., `X-Webhook-Secret`) to prevent spoofing.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.BROWSERLESS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    userId: string;
    cookies: { name: string; value: string }[];
  };

  const liAt = body.cookies.find((c) => c.name === "li_at");
  if (!liAt) {
    return NextResponse.json({ error: "li_at cookie not found" }, { status: 400 });
  }

  const encrypted = encryptCookie(liAt.value);

  await prisma.linkedinSession.upsert({
    where: { userId: body.userId },
    create: {
      userId: body.userId,
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

  publish(body.userId, { type: "linkedin:connected", data: {} });

  return NextResponse.json({ ok: true });
}
