import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Lightweight proxy — uses Auth.js v5 auth() to check session.
// Full session validation (including org/role) happens inside each route
// handler via withTenant().
export default auth((req) => {
  const { pathname } = req.nextUrl;

  const adminSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers.get("x-admin-secret");
  if (adminSecret && providedSecret === adminSecret) return NextResponse.next();

  const isProtected =
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/admin") ||
    (pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/auth") &&
      !pathname.startsWith("/api/inngest"));

  if (isProtected && !req.auth) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sign-in).*)",
  ],
};
