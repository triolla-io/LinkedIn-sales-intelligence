import { prisma } from "@/lib/prisma";
import { normalizeCompany, normalizeTitle } from "@/lib/job-check/compare";
import { judgeJobChange } from "@/lib/job-check/judge-change";
import type { JobChangeType } from "@/lib/generated/prisma/client";

export interface JobChangeInput {
  contactId: string;
  ownerId: string;
  snapshotTitle: string | null;
  snapshotCompany: string | null;
  freshTitle: string | null;
  freshCompany: string | null;
}

export interface JobChangeResult {
  result: "no_change" | "variant_only" | "change_detected";
  changeType: "company_move" | "promotion" | "title_change" | null;
}

/** A field only counts as differing when the fresh value is non-null and differs after normalization. */
export function normalizedDiff(input: JobChangeInput): {
  titleDiffers: boolean;
  companyDiffers: boolean;
} {
  const titleDiffers =
    input.freshTitle !== null &&
    normalizeTitle(input.freshTitle) !== normalizeTitle(input.snapshotTitle);
  const companyDiffers =
    input.freshCompany !== null &&
    normalizeCompany(input.freshCompany) !== normalizeCompany(input.snapshotCompany);
  return { titleDiffers, companyDiffers };
}

const CHANGE_TYPE_ENUM: Record<string, JobChangeType> = {
  company_move: "COMPANY_MOVE",
  promotion: "PROMOTION",
  title_change: "TITLE_CHANGE",
};

/**
 * Compare freshly-fetched title/company against the stored snapshot.
 * Pipeline: deterministic normalization (compare.ts) → LLM judge (judge-change.ts).
 * - Normalization-equal → no change.
 * - Judge says naming variant → advance the snapshot silently so it never re-flags.
 * - Judge says real change → record a PENDING_REVIEW ContactJobChange with a Hebrew
 *   congratulation draft, add to the org's "Job Changes" list, advance the snapshot.
 * Source-agnostic: both the Apollo and Bright Data pipelines call this.
 * The judge THROWS on LLM failure so the calling Inngest step retries — never guess.
 */
export async function recordJobChangeIfAny(input: JobChangeInput): Promise<JobChangeResult> {
  const { contactId, ownerId, snapshotTitle, snapshotCompany, freshTitle, freshCompany } = input;
  const { titleDiffers, companyDiffers } = normalizedDiff(input);

  if (!titleDiffers && !companyDiffers) {
    await prisma.contact.update({
      where: { id: contactId },
      data: { lastJobCheckAt: new Date() },
    });
    return { result: "no_change", changeType: null };
  }

  const contact = await prisma.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: { fullName: true, hebrewFirstName: true },
  });

  const judged = await judgeJobChange({
    fullName: contact.fullName,
    hebrewFirstName: contact.hebrewFirstName,
    prevTitle: snapshotTitle,
    newTitle: freshTitle,
    prevCompany: snapshotCompany,
    newCompany: freshCompany,
  });

  const newSnapshotTitle = freshTitle ?? snapshotTitle;
  const newSnapshotCompany = freshCompany ?? snapshotCompany;
  const advanceSnapshot = prisma.contact.update({
    where: { id: contactId },
    data: {
      jobSnapshotTitle: newSnapshotTitle,
      jobSnapshotCompany: newSnapshotCompany,
      lastJobCheckAt: new Date(),
    },
  });

  if (judged.changeType === "none") {
    await advanceSnapshot;
    return { result: "variant_only", changeType: null };
  }

  let list;
  try {
    list = await prisma.contactList.upsert({
      where: { ownerId_name: { ownerId, name: "Job Changes" } },
      create: { ownerId, name: "Job Changes" },
      update: {},
    });
  } catch {
    list = await prisma.contactList.findUniqueOrThrow({
      where: { ownerId_name: { ownerId, name: "Job Changes" } },
    });
  }

  await prisma.$transaction([
    prisma.contactJobChange.create({
      data: {
        contactId,
        prevTitle: snapshotTitle,
        newTitle: newSnapshotTitle,
        prevCompany: snapshotCompany,
        newCompany: newSnapshotCompany,
        changeType: CHANGE_TYPE_ENUM[judged.changeType],
        draftMessage: judged.draftMessage,
      },
    }),
    prisma.contactListMember.upsert({
      where: { listId_contactId: { listId: list.id, contactId } },
      create: { listId: list.id, contactId },
      update: {},
    }),
    advanceSnapshot,
  ]);

  return { result: "change_detected", changeType: judged.changeType };
}
