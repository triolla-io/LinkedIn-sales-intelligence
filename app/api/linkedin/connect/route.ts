import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/linkedin/sse-bus";

/**
 * POST /api/linkedin/connect
 *
 * Starts the LinkedIn login flow.
 * - If BROWSERLESS_TOKEN is set: creates a Browserless session and returns
 *   an embedUrl for the iframe login flow.
 * - Otherwise: returns a flag telling the UI to show the manual cookie form.
 *
 * The actual li_at extraction is handled by POST /api/linkedin/connect/complete
 * (called by the Browserless webhook) or POST /api/linkedin/connect/manual
 * (called by the UI when the user pastes their cookie).
 */
export const POST = withTenant(async (_req, ctx) => {
  const { effectiveUserId } = ctx;

  const browserlessToken = process.env.BROWSERLESS_TOKEN;
  const browserlessEndpoint = process.env.BROWSERLESS_ENDPOINT ?? "wss://chrome.browserless.io";

  if (!browserlessToken) {
    // Signal to the UI: show the manual cookie form
    return NextResponse.json({ mode: "manual" });
  }

  // Create a Browserless live-session
  const sessionRes = await fetch(
    `https://chrome.browserless.io/session?token=${browserlessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeout: 300_000,
        url: "https://www.linkedin.com/login",
      }),
    }
  );

  if (!sessionRes.ok) {
    return NextResponse.json({ error: "Failed to create Browserless session" }, { status: 502 });
  }

  const session = (await sessionRes.json()) as { embedUrl: string; sessionId: string };

  // Upsert a pending LinkedinSession row
  await prisma.linkedinSession.upsert({
    where: { userId: effectiveUserId },
    create: { userId: effectiveUserId, encryptedCookie: "", status: "DISCONNECTED" },
    update: { status: "DISCONNECTED" },
  });

  publish(effectiveUserId, { type: "linkedin:connecting", data: { sessionId: session.sessionId } });

  return NextResponse.json({ mode: "iframe", embedUrl: session.embedUrl });
});
