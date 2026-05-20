import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import { classify } from "@/lib/classifier/seniority";
import { getIndustry } from "@/lib/classifier/industry";
import { publish } from "@/lib/linkedin/sse-bus";
import { slugifyCompany } from "@/lib/utils/slug-utils";

const MAX_PROFILES_PER_RUN = 200;

export const syncFull = inngest.createFunction(
  {
    id: "sync-full",
    concurrency: { limit: 5 },
    triggers: [{ event: "sync.full" as const }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
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
        const { items, nextCursor } = (await step.run(
          `fetch-connections-page-${cursor ?? "start"}`,
          () => mcp.getConnections({ cursor: cursor ?? undefined })
        )) as { items: { urn: string; profileUrl: string; fullName: string; headline?: string; currentTitle?: string; currentCompany?: string; connectedAt?: string }[]; nextCursor: string | null };

        const now = new Date();
        await step.run(`upsert-connections-${cursor ?? "start"}`, async () => {
          for (const conn of items) {
            const { seniority, function: fn } = classify(conn.currentTitle || conn.headline || "");
            const industry = getIndustry(conn.currentCompany ?? "") || undefined;
            const result = await prisma.contact.upsert({
              where: { ownerId_linkedinUrn: { ownerId: userId, linkedinUrn: conn.urn } },
              create: {
                ownerId: userId,
                linkedinUrn: conn.urn,
                linkedinUrl: conn.profileUrl,
                fullName: conn.fullName,
                headline: conn.headline,
                currentTitle: conn.currentTitle || null,
                currentCompany: conn.currentCompany || null,
                seniority,
                function: fn,
                industry,
                connectedAt: conn.connectedAt ? new Date(conn.connectedAt) : null,
                lastSyncedAt: now,
              },
              update: {
                fullName: conn.fullName,
                headline: conn.headline,
                currentTitle: conn.currentTitle || undefined,
                currentCompany: conn.currentCompany || undefined,
                seniority,
                function: fn,
                industry: industry || undefined,
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

      await mcp.close();

      // Step A: stub company rows for all unique currentCompany strings
      const companySlugs = await step.run("stub-companies", async () => {
        const synced = await prisma.contact.findMany({
          where: { ownerId: userId, linkedinUrn: { in: newUrns }, currentCompany: { not: null } },
          select: { currentCompany: true },
        });

        const bySlug = new Map<string, string>();
        for (const c of synced) {
          if (!c.currentCompany) continue;
          const slug = slugifyCompany(c.currentCompany);
          if (slug) bySlug.set(slug, c.currentCompany);
        }
        if (bySlug.size === 0) return [];

        await prisma.$transaction(
          [...bySlug].map(([slug, name]) =>
            prisma.company.upsert({
              where: { universalName: slug },
              update: {},
              create: { universalName: slug, name },
            })
          )
        );
        return [...bySlug.keys()];
      });

      // Step B: set companyId on each contact
      await step.run("link-contacts-to-companies", async () => {
        if (companySlugs.length === 0) return;

        const synced = await prisma.contact.findMany({
          where: { ownerId: userId, linkedinUrn: { in: newUrns }, currentCompany: { not: null } },
          select: { id: true, currentCompany: true },
        });

        const companyRows = await prisma.company.findMany({
          where: { universalName: { in: companySlugs } },
          select: { id: true, universalName: true },
        });
        const idBySlug = new Map(companyRows.map((r) => [r.universalName, r.id]));

        for (const contact of synced) {
          if (!contact.currentCompany) continue;
          const slug = slugifyCompany(contact.currentCompany);
          const companyId = slug ? (idBySlug.get(slug) ?? null) : null;
          if (!companyId) continue;
          await prisma.contact.update({
            where: { id: contact.id },
            data: { companyId },
          });
        }
      });

      // Step 4: trigger profile enrichment for any contacts still missing
      // location / industry / companySize. enrich-profiles chains itself
      // in 100-contact batches until all are processed.
      const needsEnrich = await step.run("count-needs-enrich", () =>
        prisma.contact.count({
          where: {
            ownerId: userId,
            OR: [{ location: null }, { industry: null }, { companySize: null }],
          },
        })
      );

      if (needsEnrich > 0) {
        await step.sendEvent("emit-profiles-enrich", {
          name: "profiles.enrich" as const,
          data: { userId, total: needsEnrich },
        });
        publish(userId, { type: "linkedin:enrich-started", data: { total: needsEnrich } });
      }

      // Step 5: mark job succeeded
      await step.run("finish-job", () =>
        prisma.syncJob.update({
          where: { id: job.id },
          data: { status: "SUCCEEDED", finishedAt: new Date(), totalItems: total, processedItems: total },
        })
      );

      if (companySlugs.length > 0) {
        await step.sendEvent("emit-companies-enrich", {
          name: "companies.enrich" as const,
          data: { slugs: companySlugs },
        });
      }

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
