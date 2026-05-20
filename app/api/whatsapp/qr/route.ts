import { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { waClient } from "@/lib/whatsapp/client";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const upstream = await fetch(waClient.qrStreamUrl(ctx.effectiveUserId));

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
