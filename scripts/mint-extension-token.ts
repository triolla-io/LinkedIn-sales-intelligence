/**
 * Mint a fresh extension token for LOCAL verification and print it, so the extension can
 * be pointed at the dev server without clicking through the dashboard.
 *
 *   npx tsx --env-file=.env scripts/mint-extension-token.ts
 *
 * Refuses to run against anything but a localhost database — this rotates the user's
 * extension token, which would kick a real customer's extension offline.
 */

import { prisma } from "../lib/prisma";
import { generateToken } from "../lib/extension/token";

const USER_EMAIL = process.env.TEST_USER_EMAIL ?? "ariel@triolla.io";

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
    throw new Error("refusing to run: DATABASE_URL is not a localhost database");
  }

  const user = await prisma.user.findFirstOrThrow({
    where: { email: USER_EMAIL },
    select: { id: true, email: true },
  });
  const { raw, hash, prefix } = generateToken();

  await prisma.extensionSession.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tokenHash: hash, tokenPrefix: prefix },
    update: { tokenHash: hash, tokenPrefix: prefix, revokedAt: null, lastSeenAt: null, version: null },
  });

  console.log(`user:     ${user.email}`);
  console.log(`api base: http://localhost:3001`);
  console.log(`token:    ${raw}`);
}

main().finally(() => prisma.$disconnect());
