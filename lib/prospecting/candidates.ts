import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { cleanScrapedName, decideCandidate, type ScrapedCard } from "@/lib/prospecting/filter";
import { logProspectingEvent } from "@/lib/prospecting/events";

export type PersistResult = { inserted: number; skipped: number };

/**
 * Persist a batch of scraped search cards for a run, applying dedup + filter rules.
 * Inserted rows are DISCOVERED; filtered/duplicate rows are recorded as SKIPPED with a reason
 * (except already-pending re-scrapes, which are silently ignored to stay idempotent).
 * Bumps ProspectingRun.totalDiscovered by the number of inserts.
 */
export async function persistCandidates(
  ownerId: string,
  runId: string,
  cards: ScrapedCard[]
): Promise<PersistResult> {
  if (cards.length === 0) return { inserted: 0, skipped: 0 };

  const urns = cards.map((c) => c.urn);
  const [contacts, requests] = await Promise.all([
    prisma.contact.findMany({
      where: { ownerId, linkedinUrn: { in: urns } },
      select: { linkedinUrn: true },
    }),
    prisma.connectionRequest.findMany({
      where: { ownerId, linkedinUrn: { in: urns } },
      select: { linkedinUrn: true },
    }),
  ]);

  const ctx = {
    existingContactUrns: new Set(contacts.map((c) => c.linkedinUrn)),
    existingRequestUrns: new Set(requests.map((r) => r.linkedinUrn)),
  };

  let inserted = 0;
  let skipped = 0;
  const seenInBatch = new Set<string>();

  for (const card of cards) {
    if (seenInBatch.has(card.urn)) continue; // de-dupe within the same page
    seenInBatch.add(card.urn);

    const fullName = cleanScrapedName(card.name);

    const decision = decideCandidate(card, ctx);
    if (decision.action === "skip") {
      if (decision.skipReason === "already_pending") continue; // idempotent: row already exists
      try {
        await prisma.connectionRequest.create({
          data: {
            ownerId,
            runId,
            linkedinUrn: card.urn,
            linkedinUrl: card.profileUrl,
            fullName,
            headline: card.headline,
            currentTitle: card.title,
            currentCompany: card.company,
            location: card.location,
            status: "SKIPPED",
            skipReason: decision.skipReason,
          },
        });
        skipped++;
        await logProspectingEvent({
          runId,
          type: "SKIPPED",
          message: `${fullName || card.profileUrl} — ${decision.skipReason}`,
          detail: { skipReason: decision.skipReason },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // Concurrent insert of the same URN — already recorded, treat as a no-op.
        } else {
          throw e;
        }
      }
      ctx.existingRequestUrns.add(card.urn);
      continue;
    }

    try {
      await prisma.connectionRequest.create({
        data: {
          ownerId,
          runId,
          linkedinUrn: card.urn,
          linkedinUrl: card.profileUrl,
          fullName,
          headline: card.headline,
          currentTitle: card.title,
          currentCompany: card.company,
          location: card.location,
          status: "DISCOVERED",
        },
      });
      inserted++;
      await logProspectingEvent({
        runId,
        type: "DISCOVERED",
        message: fullName || card.profileUrl,
        detail: { title: card.title, company: card.company, location: card.location },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Concurrent insert of the same URN — already recorded, treat as a no-op.
      } else {
        throw e;
      }
    }
    ctx.existingRequestUrns.add(card.urn);
  }

  if (inserted > 0) {
    await prisma.prospectingRun.update({
      where: { id: runId },
      data: { totalDiscovered: { increment: inserted } },
    });
  }

  return { inserted, skipped };
}
