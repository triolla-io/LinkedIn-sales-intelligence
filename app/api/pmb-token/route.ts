import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { withTenant } from "@/lib/tenancy/with-tenant";

// Mints a short-lived pass proving who the logged-in user is, signed by our
// backend. The PM Bridge widget calls this to authenticate the current user.
export const GET = withTenant(async (_req: NextRequest, ctx) => {
  const email = ctx.user.email;

  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(process.env.PMB_API_KEY!)
    .setAudience("pm-bridge-box")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.PMB_SIGNING_SECRET!));

  return new Response(token, { headers: { "content-type": "text/plain" } });
});
