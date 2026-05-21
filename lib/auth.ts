import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: Role;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

// Custom adapter: extends PrismaAdapter to atomically create Org + User
// on first sign-in (NextAuth calls createUser when no account exists yet).
const baseAdapter = PrismaAdapter(prisma);
const adapter = {
  ...baseAdapter,
  createUser: async (data: { email: string; name?: string | null; image?: string | null; emailVerified: Date | null }) => {
    const org = await prisma.organization.create({
      data: { name: `${data.name ?? data.email}'s Org` },
    });
    return prisma.user.create({
      data: {
        email: data.email,
        name: data.name ?? data.email,
        image: data.image,
        emailVerified: data.emailVerified,
        orgId: org.id,
        role: "SALESPERSON",
      },
    });
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: adapter as any,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, orgId: true, role: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.orgId = dbUser.orgId;
          token.role = dbUser.role;

          // PrismaAdapter doesn't implement updateAccount, so we sync the
          // OAuth tokens/scope ourselves on every sign-in (including re-auth).
          if (account?.provider) {
            await prisma.account.updateMany({
              where: { userId: dbUser.id, provider: account.provider },
              data: {
                ...(account.access_token != null && { access_token: account.access_token }),
                ...(account.refresh_token != null && { refresh_token: account.refresh_token }),
                ...(account.expires_at != null && { expires_at: account.expires_at }),
                ...(account.scope != null && { scope: account.scope }),
              },
            });
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.orgId = token.orgId as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});
