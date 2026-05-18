import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import { classify } from "@/lib/classifier/seniority";
import { publish } from "@/lib/linkedin/sse-bus";

const MAX_PROFILES_PER_RUN = 200;

export const syncFull = inngest.createFunction(
  {
    id: "sync-full",
    concurrency: { limit: 5 },
  },
  { event: "sync.full" },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };

    // Step 1: load session
    const session = await step.run("load-session", async () => {
      return prisma.linkedinSession.findUnique({ where: { userId } });
    });

    if (!session || session.status !== "ACTIVE") {
      return { skipped: true, reason: "no active session" };
    }

    // Step 2: create sync job
    const job = await step.run("create-sync-job", async () => {
      return prisma.syncJob.create({
        data: { userId, type: "FULL", status: "RUNNING", startedAt: new Date() },
      });
    });

    try {
      // Step 3: fetch all connections + upsert
      const cookiePlain = decryptCookie(session.encryptedCookie);
      const mcp = await LinkedinMcp.open(cookiePlain);

      let cursor: string | null = null;
      let total = 0;
      const newUrns: string[] = [];

      do {
        const { items, nextCursor } = await step.run(
          `fetch-connections-page-${cursor ?? "start"}`,
          () => mcp.getConnections({ cursor: cursor ?? undefined })
        );

        const now = new Date();
        await step.run(`upsert-connections-${cursor ?? "start"}`, async () => {
          for (const conn of items) {
            const result = await prisma.contact.upsert({
              where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: conn.urn } },
              create: {
                ownerId: userId,
                linkedinUrn: conn.urn,
                linkedinUrl: conn.profileUrl,
                fullName: conn.fullName,
                headline: conn.headline,
                connectedAt: conn.connectedAt ? new Date(conn.connectedAt) : null,
                lastSyncedAt: now,
              },
              update: {
                fullName: conn.fullName,
                headline: conn.headline,
                lastSyncedAt: now,
                removedAt: null,
              },
            });
            newUrns.push(result.linkedinUrn);
          }
        });

        publish(userId, {
          type: "linkedin:sync-progress",
          data: { processed: total + items.length, type: "FULL" },
        });

        total += items.length;
        cursor = nextCursor;
      } while (cursor !== null && total < MAX_PROFILES_PER_RUN);

      // Step 4: enrich new contacts with profiles
      const newContacts = await step.run("find-new-contacts", () =>
        prisma.contact.findMany({
          where: { ownerId: userId, currentTitle: null, linkedinUrn: { in: newUrns } },
          select: { id: true, linkedinUrn: true },
          take: MAX_PROFILES_PER_RUN,
        })
      );

      for (const contact of newContacts) {
        const profile = await step.run(`get-profile-${contact.id}`, () =>
          mcp.getProfile(contact.linkedinUrn)
        );

        const { seniority, function: fn } = classify(profile.currentTitle ?? "");

        await step.run(`update-profile-${contact.id}`, () =>
          prisma.contact.update({
            where: { id: contact.id },
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
      }

      await mcp.close();

      // Step 5: mark job succeeded
      await step.run("finish-job", () =>
        prisma.syncJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", finishedAt: new Date(), totalItems: total, processedItems: total },
        })
      );

      publish(userId, { type: "linkedin:sync-done", data: { total } });

      return { success: true, total };
    } catch (err) {
      if (err instanceof RateLimitError) {
        await prisma.syncJob.update({
          where: { id: job.id },
          data: { status: "PAUSED", errorMessage: "Rate limited — will retry in 4h" },
        });
        // Re-emit with 4-hour delay
        await step.sendEvent("requeue-after-rate-limit", {
          name: "sync.full",
          data: { userId },
        });
        return { rateLimited: true };
      }

      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: String(err) },
      });
      throw err;
    }
  }
);
