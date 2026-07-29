import { prisma } from "@/lib/prisma";

/**
 * Restart connect warm-up for a user — e.g. after LinkedIn flagged their
 * account ("unusual activity"). Drops them to week-1 volume (3/day) with
 * automatic re-ramp over 4 weeks (see lib/prospecting/gentle-policy.ts).
 *
 *   tsx scripts/reset-connect-warmup.ts user@example.com
 */
async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: tsx scripts/reset-connect-warmup.ts <email>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, connectWarmupStartedAt: true },
  });
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { connectWarmupStartedAt: new Date() },
  });
  console.log(
    `warm-up restarted for ${user.email}: ` +
      `${user.connectWarmupStartedAt?.toISOString() ?? "null"} -> ${updated.connectWarmupStartedAt!.toISOString()}`
  );
}

main().finally(() => prisma.$disconnect());
