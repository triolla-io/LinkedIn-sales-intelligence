import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Lightweight proxy — only decodes the JWT cookie; never touches the DB.
// Full session validation (including org/role) happens inside each route
// handler via withTenant().
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const isProtected =
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/admin") ||
    (pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/auth") &&
      !pathname.startsWith("/api/inngest"));

  if (isProtected && !token) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sign-in).*)",
  ],
};
