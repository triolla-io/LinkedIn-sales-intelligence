// Persist a SCRAPE_POSTS extension result and fan out draft events for fresh posts.
import { prisma } from "@/lib/prisma";
import { inngest } from "@/inngest/client";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  MAX_POST_AGE_DAYS,
  parsePostedAgo,
  postUrlFromUrn,
  validateScrapedPosts,
} from "@/lib/post-comments/posts";

const DAY_MS = 24 * 60 * 60 * 1000;

// On a person's first scrape every returned post is "new" — up to 10 of them. Capping the
// number of DRAFTS (not persisted rows) per ingest keeps day-one from flooding the review
// queue and the LLM budget. At the real cadence (roughly one post/day per person) the cap
// never bites, since a re-scrape only ever sees 0-1 new posts.
const MAX_DRAFTS_PER_INGEST = 3;

/**
 * Persist a SCRAPE_POSTS result. New posts are created once per (owner, urn);
 * only fresh ones (<= MAX_POST_AGE_DAYS, or unknown age) get a draft event, capped at
 * MAX_DRAFTS_PER_INGEST per call. Re-scrapes are idempotent: existing urns are skipped
 * entirely, and a unique-constraint race on create is treated as "already ingested".
 */
export async function ingestScrapedPosts(task: {
  id: string;
  payload: unknown;
  result: unknown;
}): Promise<{ created: number; drafted: number }> {
  const payload = task.payload as { contactId?: string };
  const contactId = payload?.contactId;
  if (!contactId) return { created: 0, drafted: 0 };

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, ownerId: true, postWatchEnabled: true },
  });
  if (!contact) return { created: 0, drafted: 0 };

  const posts = validateScrapedPosts((task.result as { posts?: unknown })?.posts);
  if (posts.length === 0) return { created: 0, drafted: 0 };

  const now = new Date();
  const existing = await prisma.linkedInPost.findMany({
    where: { ownerId: contact.ownerId, activityUrn: { in: posts.map((p) => p.urn) } },
    select: { activityUrn: true },
  });
  const known = new Set(existing.map((e) => e.activityUrn));

  // The extension returns posts in page order (newest first) — validateScrapedPosts
  // preserves that order, so "first MAX_DRAFTS_PER_INGEST that qualify" IS "3 most
  // recent". Do not sort here; sorting would require a reliable postedAt, which
  // unparseable postedAgoText does not give us.
  const toDraft: string[] = [];
  let created = 0;
  for (const p of posts) {
    if (known.has(p.urn)) continue;
    const postedAt = p.postedAgoText ? parsePostedAgo(p.postedAgoText, now) : null;

    let row;
    try {
      row = await prisma.linkedInPost.create({
        data: {
          contactId: contact.id,
          ownerId: contact.ownerId,
          activityUrn: p.urn,
          postUrl: postUrlFromUrn(p.urn),
          text: p.text,
          postedAgoText: p.postedAgoText,
          postedAt,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // Concurrent/overlapping scrape already inserted this urn — treat as a no-op.
        continue;
      }
      throw e;
    }
    created += 1;

    // Unknown age (postedAgoText missing or unparseable) is treated as fresh: it is
    // far more likely to be a DOM/format drift on a genuinely new post than an old
    // post whose age string happened to fail parsing, and treating it as stale would
    // silently drop a real new post from the review queue with no signal anywhere.
    const fresh =
      postedAt === null || now.getTime() - postedAt.getTime() <= MAX_POST_AGE_DAYS * DAY_MS;
    if (fresh && contact.postWatchEnabled === true && toDraft.length < MAX_DRAFTS_PER_INGEST) {
      toDraft.push(row.id);
    }
  }

  if (toDraft.length > 0) {
    await inngest.send(
      toDraft.map((postId) => ({ name: "post-comments.draft" as const, data: { postId } }))
    );
  }
  return { created, drafted: toDraft.length };
}
