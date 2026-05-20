import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { decryptCookie } from "@/lib/linkedin/cookie-crypto";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import { classify } from "@/lib/classifier/seniority";
import { getIndustry } from "@/lib/classifier/industry";
import { publish } from "@/lib/linkedin/sse-bus";
import { slugifyCompany } from "@/lib/utils/slug-utils";

const MAX_PROFILES_PER_RUN = 200;
const PROFILE_STALE_DAYS = 30;

export const syncDelta = inngest.createFunction(
  {
    id: "sync-delta",
    concurrency: { limit: 10 },
    triggers: [{ event: "sync.delta" as const }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
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
        const { items, nextCursor } = (await step.run(
          `fetch-connections-${cursor ?? "start"}`,
          () => mcp.getConnections({ cursor: cursor ?? undefined })
        )) as { items: { urn: string }[]; nextCursor: string | null };
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

      const existingMap = new Map(
        (existing as { id: string; linkedinUrn: string; lastSyncedAt: Date }[]).map((c) => [c.linkedinUrn, c])
      );

      // New contacts = in fetched but not in DB
      const newUrns = [...fetchedUrns].filter((urn) => !existingMap.has(urn));

      // Removed contacts = in DB but not in fetched
      const removedUrns = [...existingMap.keys()].filter((urn) => !fetchedUrns.has(urn));

      // Soft-remove
      if (removedUrns.length > 0) {
        await step.run("soft-remove", () =>
          prisma.contact.updateMany({
            where: { ownerId: userId, linkedinUrn: { in: removedUrns as string[] } },
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

      const enrichedCompanyMap = new Map<string, string>(); // slug → displayName

      for (const contact of toEnrich) {
        const profile = await step.run(`get-profile-${contact.id}`, () =>
          mcp.getProfile(contact.linkedinUrn)
        );
        if (profile.currentCompany) {
          const slug = slugifyCompany(profile.currentCompany);
          if (slug) enrichedCompanyMap.set(slug, profile.currentCompany);
        }
        const { seniority, function: fn } = classify(profile.currentTitle ?? "");
        const industry = getIndustry(profile.currentCompany ?? "") || undefined;
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
              industry: industry || undefined,
              lastSyncedAt: new Date(),
            },
          })
        );
      }

      await mcp.close();

      const newCompanySlugs = await step.run("stub-companies", async () => {
        if (enrichedCompanyMap.size === 0) return [];

        await prisma.$transaction(
          [...enrichedCompanyMap].map(([slug, name]) =>
            prisma.company.upsert({
              where: { universalName: slug },
              update: {},
              create: { universalName: slug, name },
            })
          )
        );
        return [...enrichedCompanyMap.keys()];
      });

      await step.run("link-contacts-to-companies", async () => {
        if (newCompanySlugs.length === 0) return;

        // Only link contacts whose profile was just enriched
        const enrichedContacts = await prisma.contact.findMany({
          where: {
            ownerId: userId,
            id: { in: toEnrich.map((c: { id: string }) => c.id) },
            currentCompany: { not: null },
          },
          select: { id: true, currentCompany: true },
        });

        const companyRows = await prisma.company.findMany({
          where: { universalName: { in: newCompanySlugs } },
          select: { id: true, universalName: true },
        });
        const idBySlug = new Map(companyRows.map((r) => [r.universalName, r.id]));

        for (const contact of enrichedContacts) {
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

      if (newCompanySlugs.length > 0) {
        // Only re-enrich companies that don't have staffCount yet
        const alreadyEnriched = await prisma.company.findMany({
          where: { universalName: { in: newCompanySlugs }, staffCount: { not: null } },
          select: { universalName: true },
        });
        const enrichedSet = new Set(alreadyEnriched.map((r: { universalName: string }) => r.universalName));
        const toEnrichSlugs = newCompanySlugs.filter((s: string) => !enrichedSet.has(s));
        if (toEnrichSlugs.length > 0) {
          await step.sendEvent("emit-companies-enrich", {
            name: "companies.enrich" as const,
            data: { slugs: toEnrichSlugs },
          });
        }
      }

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
