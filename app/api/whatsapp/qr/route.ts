import { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  let upstream: Response;
  try {
    const connectAbort = new AbortController();
    const connectTimeout = setTimeout(() => connectAbort.abort(), 10000);
    upstream = await fetch(waClient.qrStreamUrl(ctx.effectiveUserId), { signal: connectAbort.signal });
    clearTimeout(connectTimeout);
  } catch {
    const body = `event: error\ndata: ${JSON.stringify({ error: "whatsapp_service_unavailable" })}\n\n`;
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
