/**
 * Mints a NextAuth (Auth.js v5) JWE session token so a browser can be
 * logged in as an existing user without going through Google OAuth.
 *
 * Usage:
 *   NEXTAUTH_SECRET=<prod secret> \
 *   SID=<user id> SORG=<orgId> SROLE=<role> SEMAIL=<email> SNAME=<name> \
 *   npx tsx scripts/mint-session.ts
 *
 * Paste the printed value into the browser as cookie:
 *   name:  __Secure-authjs.session-token   (https)
 *   value: <printed token>
 *   domain: sales.triolla.io   path: /   Secure  HttpOnly
 */
import { encode } from "next-auth/jwt";

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) throw new Error("Set NEXTAUTH_SECRET (pull it from the prod app container)");

const id = process.env.SID;
const orgId = process.env.SORG;
if (!id || !orgId) throw new Error("Set SID and SORG (from the DB query)");

const THIRTY_DAYS = 60 * 60 * 24 * 30;

async function main() {
  const token = await encode({
    secret,
    salt: "__Secure-authjs.session-token", // must equal the cookie name
    maxAge: THIRTY_DAYS,
    token: {
      id,
      sub: id,
      orgId,
      role: process.env.SROLE ?? "SALESPERSON",
      email: process.env.SEMAIL ?? "",
      name: process.env.SNAME ?? "",
    },
  });

  console.log("\nCookie name:  __Secure-authjs.session-token");
  console.log("Cookie value:\n");
  console.log(token);
  console.log("\nValid for 30 days. Set it on https://sales.triolla.io (Secure + HttpOnly).\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
