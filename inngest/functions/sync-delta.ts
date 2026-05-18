import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import { classify } from "@/lib/classifier/seniority";
import { publish } from "@/lib/linkedin/sse-bus";

const MAX_PROFILES_PER_RUN = 200;
const PROFILE_STALE_DAYS = 30;

export const syncDelta = inngest.createFunction(
  {
    id: "sync-delta",
    concurrency: { limit: 10 },
  },
  { event: "sync.delta" },
  async ({ event, step }) => {
    const { userId } = event.data as { userId: string };

    const session = await step.run("load-session", () =>
      prisma.linkedinSession.findUnique({ where: { userId } })
    );

    if (!session || session.status !== "ACTIVE") {
      return { skipped: true };
    }

    const job = await step.run("create-sync-job", () =>
      prisma.syncJob.create({
        data: { userId, type: "DELTA", status: "RUNNING", startedAt: new Date() },
      })
    );

    const cookiePlain = decryptCookie(session.encryptedCookie);
    const mcp = await LinkedinMcp.open(cookiePlain);

    // Validate cookie first
    const cookieValid = await step.run("validate-cookie", () => mcp.validateCookie());
    if (!cookieValid) {
      await prisma.linkedinSession.update({
        where: { userId },
        data: { status: "EXPIRED" },
      });
      publish(userId, { type: "linkedin:expired", data: {} });
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", errorMessage: "Cookie expired" },
      });
      return { expired: true };
    }

    try {
      // Fetch current connection URN set
      let cursor: string | null = null;
      let total = 0;
      const fetchedUrns = new Set<string>();

      do {
        const { items, nextCursor } = await step.run(
          `fetch-connections-${cursor ?? "start"}`,
          () => mcp.getConnections({ cursor: cursor ?? undefined })
        );
        items.forEach((c) => fetchedUrns.add(c.urn));
        total += items.length;
        cursor = nextCursor;
      } while (cursor !== null && total < MAX_PROFILES_PER_RUN);

      // Load existing active contacts
      const existing = await step.run("load-existing", () =>
        prisma.contact.findMany({
          where: { ownerId: userId, removedAt: null },
          select: { id: true, linkedinUrn: true, lastSyncedAt: true },
        })
      );

      const existingMap = new Map(existing.map((c) => [c.linkedinUrn, c]));

      // New contacts = in fetched but not in DB
      const newUrns = [...fetchedUrns].filter((urn) => !existingMap.has(urn));

      // Removed contacts = in DB but not in fetched
      const removedUrns = [...existingMap.keys()].filter((urn) => !fetchedUrns.has(urn));

      // Soft-remove
      if (removedUrns.length > 0) {
        await step.run("soft-remove", () =>
          prisma.contact.updateMany({
            where: { ownerId: userId, linkedinUrn: { in: removedUrns } },
            data: { removedAt: new Date() },
          })
        );
      }

      // Upsert new contacts
      for (const urn of newUrns) {
        await step.run(`upsert-new-${urn}`, () =>
          prisma.contact.upsert({
            where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: urn } },
            create: { ownerId: userId, linkedinUrn: urn, linkedinUrl: `https://linkedin.com/in/${urn}`, fullName: "", lastSyncedAt: new Date() },
            update: { removedAt: null, lastSyncedAt: new Date() },
          })
        );
      }

      // Enrich: new contacts OR stale ones (> 30 days old)
      const staleThreshold = new Date(Date.now() - PROFILE_STALE_DAYS * 86_400_000);
      const toEnrich = await step.run("find-to-enrich", () =>
        prisma.contact.findMany({
          where: {
            ownerId: userId,
            removedAt: null,
            OR: [
              { currentTitle: null },
              { lastSyncedAt: { lt: staleThreshold } },
            ],
          },
          select: { id: true, linkedinUrn: true },
          take: MAX_PROFILES_PER_RUN,
        })
      );

      for (const contact of toEnrich) {
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
              lastSyncedAt: new Date(),
            },
          })
        );
      }

      await mcp.close();

      await step.run("finish-job", () =>
        prisma.syncJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", finishedAt: new Date(), totalItems: total, processedItems: total },
        })
      );

      await step.run("update-user-sync-time", () =>
        prisma.linkedinSession.update({
          where: { userId },
          data: { lastValidatedAt: new Date() },
        })
      );

      publish(userId, { type: "linkedin:sync-done", data: { new: newUrns.length, removed: removedUrns.length } });

      return { success: true, new: newUrns.length, removed: removedUrns.length };
    } catch (err) {
      if (err instanceof RateLimitError) {
        await prisma.syncJob.update({
          where: { id: job.id },
          data: { status: "PAUSED", errorMessage: "Rate limited" },
        });
        await step.sendEvent("requeue-delta", { name: "sync.delta", data: { userId } });
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
