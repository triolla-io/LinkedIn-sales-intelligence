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

  // Token-authenticated clients (the Chrome extension) carry a Bearer token, not
  // an Auth.js session cookie. Let them through so the route handler's
  // withExtensionAuth can validate the token — without it the proxy would
  // redirect every extension poll to /sign-in (307). Routes that use withTenant
  // instead still enforce their own session check, so this exposes nothing.
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return NextResponse.next();

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
