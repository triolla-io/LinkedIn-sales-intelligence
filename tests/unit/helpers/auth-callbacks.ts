import { prisma } from "@/lib/prisma";

// Extracted signIn logic for unit testing without spinning up NextAuth
export async function signInCallback(user: { email?: string; name?: string }) {
  if (!user.email) return false;

  const existing = await prisma.user.findUnique({
    where: { email: user.email },
  });

  if (!existing) {
    await prisma.$transaction(async (tx: any) => {
      const org = await tx.organization.create({
        data: { name: `${user.name ?? user.email}'s Org` },
      });
      await tx.user.create({
        data: {
          email: user.email!,
          name: user.name ?? user.email!,
          orgId: org.id,
          role: "SALESPERSON",
        },
      });
    });
  }

  return true;
}
