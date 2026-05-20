import { NextRequest } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";

const WHATSAPP_SERVICE_URL =
  process.env.WHATSAPP_SERVICE_URL ?? "http://localhost:3002";

export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const upstream = await fetch(
    `${WHATSAPP_SERVICE_URL}/session/${ctx.effectiveUserId}/qr`
  );

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
