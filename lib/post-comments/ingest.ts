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
 * re-scrapes are idempotent: existing urns are skipped entirely, and a unique-constraint
 * race on create is treated as "already ingested".
 *
 * The draft set is derived from the database AFTER persistence, not collected in memory
 * during the loop: this handler runs with no step.run boundaries, so a throw partway
 * through the loop (transient DB error, deploy restart, OOM) re-runs the whole function.
 * An in-memory "posts I just created" list would not survive that retry — the posts are
 * already persisted (and skipped via `known` on replay), so they'd never be reconsidered
 * for a draft, and there is nothing else that would ever detect they still need one. That
 * is a silent, permanent loss on retry. Deriving "still needs a draft" from
 * `drafts: { none: {} }` self-heals: whatever crashed mid-run, the next ingest (or the
 * next daily scrape) recomputes the same candidate set from committed state.
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

  let created = 0;
  for (const p of posts) {
    if (known.has(p.urn)) continue;
    const postedAt = p.postedAgoText ? parsePostedAgo(p.postedAgoText, now) : null;

    try {
      await prisma.linkedInPost.create({
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
  }

  if (contact.postWatchEnabled !== true) return { created, drafted: 0 };

  // Unknown age (postedAgoText missing or unparseable) is treated as fresh, same as
  // before: it is far more likely to be a DOM/format drift on a genuinely new post than
  // an old post whose age string happened to fail parsing, and treating it as stale
  // would silently drop a real new post from the review queue with no signal anywhere.
  const cutoff = new Date(now.getTime() - MAX_POST_AGE_DAYS * DAY_MS);
  const candidates = await prisma.linkedInPost.findMany({
    where: {
      contactId: contact.id,
      drafts: { none: {} },
      OR: [{ postedAt: null }, { postedAt: { gte: cutoff } }],
    },
    // postedAt DESC ranks confirmed-recent posts first. Rows with unknown age (postedAt
    // null) are pushed to the end of that ordering (`nulls: "last"`) rather than the
    // front (Postgres's own default for DESC): a null is "fresh" but not "confirmed most
    // recent," so it must not out-rank actually-dated recent posts for the capped slots.
    // It still can't vanish — the OR clause above keeps it a candidate every run — it
    // just waits behind dated posts, same as any other post held back by the cap.
    // createdAt DESC is the tiebreak, which matters most among the null group itself
    // (all sharing postedAt = null): it surfaces the most recently scraped one first
    // instead of leaving null rows in undefined/insertion order.
    orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: MAX_DRAFTS_PER_INGEST,
    select: { id: true },
  });

  if (candidates.length > 0) {
    await inngest.send(
      candidates.map((c) => ({ name: "post-comments.draft" as const, data: { postId: c.id } }))
    );
  }
  return { created, drafted: candidates.length };
}
