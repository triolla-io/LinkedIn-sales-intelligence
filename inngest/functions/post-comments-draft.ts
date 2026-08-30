import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { draftPostComment } from "@/lib/post-comments/draft";

/**
 * Draft ONE comment for ONE fresh post, per `post-comments.draft` (Task 7's ingest emits
 * one of these per post that still needs a draft).
 *
 * Concurrency is keyed on the post, not just capped globally: Task 7 derives its draft set
 * from database state (`drafts: { none: {} }`), so two overlapping ingests of the same
 * profile can each decide the same post still needs a draft and both send this event before
 * either draft row exists. Keying on `postId` serializes those two invocations — the second
 * one runs only after the first has committed its draft, sees `drafts.length > 0`, and
 * returns `already_drafted` BEFORE calling the model. Without the key both would pay for an
 * LLM call and only one would win the `postId @unique` constraint on create.
 *
 * The create is still wrapped in try/catch for a P2002 as the last line of defense — e.g. a
 * duplicate event delivered after Inngest's own dedup window, or two different processes
 * racing outside the key's serialization guarantee.
 */
export const postCommentsDraft = inngest.createFunction(
  {
    id: "post-comments-draft",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.postId" },
    triggers: [{ event: "post-comments.draft" as const }],
  },
  async ({ event, step }) => {
    const { postId } = event.data as { postId: string };

    const post = await step.run("load", () =>
      prisma.linkedInPost.findUnique({
        where: { id: postId },
        select: {
          id: true,
          text: true,
          contactId: true,
          ownerId: true,
          contact: { select: { fullName: true } },
          drafts: { select: { id: true } },
        },
      })
    );
    if (!post) return { skipped: "post_gone" };
    if (post.drafts.length > 0) return { skipped: "already_drafted" };

    const comment = await step.run("draft", () =>
      draftPostComment({ fullName: post.contact.fullName, postText: post.text })
    );

    return step.run("save", async () => {
      try {
        await prisma.postCommentDraft.create({
          data: {
            postId: post.id,
            contactId: post.contactId,
            ownerId: post.ownerId,
            commentText: comment,
          },
        });
        return { drafted: true };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // The concurrency key above should make this unreachable in practice; this is
          // the last line of defense, not the primary guard against duplicate spend.
          return { skipped: "already_drafted" };
        }
        throw e;
      }
    });
  }
);
