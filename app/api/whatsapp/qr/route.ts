import { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  let upstream: Response;
  try {
    upstream = await fetch(waClient.qrStreamUrl(ctx.effectiveUserId));
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
