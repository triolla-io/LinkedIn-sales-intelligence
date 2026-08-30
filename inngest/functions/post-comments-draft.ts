import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { draftPostComment, PostCommentGuardError } from "@/lib/post-comments/draft";

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
 * Every create below is still wrapped for a P2002 as the last line of defense — e.g. a
 * duplicate event delivered after Inngest's own dedup window, or two different processes
 * racing outside the key's serialization guarantee.
 */

/**
 * Create the PostCommentDraft row (real draft or a DISMISSED terminal record). Returns
 * `false` instead of throwing on a P2002 — the row already exists, which this function
 * treats as "somebody else won the race," not a failure.
 */
async function createDraftRow(
  post: { id: string; contactId: string; ownerId: string },
  data: { commentText: string; status?: "DISMISSED"; dismissReason?: string }
): Promise<boolean> {
  try {
    await prisma.postCommentDraft.create({
      data: {
        postId: post.id,
        contactId: post.contactId,
        ownerId: post.ownerId,
        ...data,
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return false;
    }
    throw e;
  }
}

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

    let comment: string;
    try {
      comment = await step.run("draft", () =>
        draftPostComment({ fullName: post.contact.fullName, postText: post.text })
      );
    } catch (e) {
      // Only a PostCommentGuardError is terminal-and-recordable: the model answered but
      // its text could never pass the guard, even after one repair attempt. Retrying that
      // spends money to reproduce the same rejection, and — because Task 7 re-selects any
      // post with no draft row every ingest for as long as it stays inside the freshness
      // window — an unhandled throw here would otherwise cost up to ~6 model calls PER
      // INGEST for as long as the post stays fresh (~7 daily ingests), not once. Writing a
      // DISMISSED row removes the post from `drafts: { none: {} }` after this one attempt.
      //
      // Anything else (plain Error from "no usable response at all," OpenRouterBlockedError
      // from the kill-switch/budget) must keep propagating so Inngest retries the whole
      // function — those are transient, and swallowing them would silently and permanently
      // drop every draft across every watched person during e.g. an OpenRouter outage.
      if (e instanceof PostCommentGuardError) {
        return step.run("dismiss", () =>
          createDraftRow(post, {
            commentText: `[guard rejected] ${e.violations.join(", ")}`,
            status: "DISMISSED",
            dismissReason: "draft_failed",
          }).then((created) => ({ skipped: created ? "draft_failed" : "already_drafted" }))
        );
      }
      throw e;
    }

    return step.run("save", () =>
      createDraftRow(post, { commentText: comment }).then((created) =>
        created ? { drafted: true } : { skipped: "already_drafted" }
      )
    );
  }
);
