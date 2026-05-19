import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { LinkedinMcp } from "@/lib/linkedin/mcp-client";
import { classify } from "@/lib/classifier/seniority";

export const profileEnrich = inngest.createFunction(
  {
    id: "profile-enrich",
    concurrency: { limit: 3 },
    triggers: [{ event: "profile.enrich" as const }],
  },
  async ({ event, step }: any) => {
    const { contactId, userId } = event.data as { contactId: string; userId: string };

    const contact = await step.run("load-contact", () =>
      prisma.contact.findUnique({ where: { id: contactId } })
    );

    if (!contact || contact.currentTitle) return { skipped: true };

    const session = await step.run("load-session", () =>
      prisma.linkedinSession.findUnique({ where: { userId } })
    );

    if (!session || session.status !== "ACTIVE") return { skipped: true };

    const profile = await step.run("get-profile", async () => {
      const cookie = decryptCookie(session.encryptedCookie);
      const mcp = await LinkedinMcp.open(cookie);
      try {
        return await mcp.getProfile(contact.linkedinUrn);
      } finally {
        await mcp.close();
      }
    });

    const { seniority, function: fn } = classify(profile.currentTitle ?? "");

    await step.run("save-profile", () =>
      prisma.contact.update({
        where: { id: contactId },
        data: {
          currentTitle: profile.currentTitle,
          currentCompany: profile.currentCompany,
          currentCompanyId: profile.currentCompanyId,
          companySize: profile.companySize,
          location: profile.location,
          profilePicUrl: profile.profilePicUrl,
          seniority,
          function: fn,
        },
      })
    );

    return { success: true };
  }
);
