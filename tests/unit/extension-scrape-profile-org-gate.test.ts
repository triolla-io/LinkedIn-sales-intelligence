import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The org-gate fix for Task 4's review round 1: the radar's SCRAPE_PROFILE source
 * (lib/job-check/dispatch.ts) is gated on Contact.radarInclude alone, not
 * Org.jobCheckEnabled — it is the first-ever SCRAPE_PROFILE producer that isn't. So an
 * org that switched "Job Changes" OFF can still produce a scrape completion, and
 * handleScrapeProfile must not let that reach the paid half of the pipeline:
 * judgeJobChange (lib/job-check/judge-change.ts) is a real openrouterChat call, and a
 * `company_move` result creates a ContactJobChange row and a "Job Changes" list entry.
 *
 * Unlike tests/unit/extension-scrape-profile-result.test.ts, this file does NOT mock
 * recordJobChangeIfAny away — it runs the real lib/job-check/detect-change.ts and mocks
 * only judgeJobChange, so the assertion below is against the actual LLM boundary, not an
 * intermediate function.
 */

const mockFindContact = vi.fn();
const mockContactUpdate = vi.fn();
const mockFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findUnique: (...a: unknown[]) => mockFindContact(...a),
      update: (...a: unknown[]) => mockContactUpdate(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockFindUniqueOrThrow(...a),
    },
  },
}));

const mockJudge = vi.fn();
vi.mock("@/lib/job-check/judge-change", () => ({
  judgeJobChange: (...a: unknown[]) => mockJudge(...a),
}));

import { handleScrapeProfile } from "@/inngest/functions/extension-task-result";

beforeEach(() => {
  mockFindContact.mockReset();
  mockContactUpdate.mockReset();
  mockFindUniqueOrThrow.mockReset();
  mockJudge.mockReset();
  mockContactUpdate.mockResolvedValue({});
  mockFindUniqueOrThrow.mockResolvedValue({ fullName: "Dana Cohen", hebrewFirstName: "דנה" });
  // "title_change" (not "company_move") so recordJobChangeIfAny's advance-and-return
  // branch runs without needing contactList/contactJobChange mocks — irrelevant to what
  // this file is pinning, which is whether judgeJobChange gets called at all.
  mockJudge.mockResolvedValue({ changeType: "title_change", draftMessage: null });
});

function scrapeTask() {
  return {
    userId: "o1",
    payload: { contactId: "c1" },
    result: { title: "CTO", company: "New" },
  } as never;
}

describe("handleScrapeProfile — job-change judge gated on Org.jobCheckEnabled", () => {
  it("an org with jobCheckEnabled: false writes the profile fields but never reaches judgeJobChange", async () => {
    mockFindContact.mockResolvedValue({
      ownerId: "o1",
      jobSnapshotTitle: "Dev",
      jobSnapshotCompany: "Old",
      owner: { org: { jobCheckEnabled: false } },
    });

    await handleScrapeProfile(scrapeTask());

    // The radar's data — unconditional, costs nothing.
    expect(mockContactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ profileScrapedAt: expect.any(Date) }),
      })
    );
    // The paid half never fires.
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it("an org with jobCheckEnabled: true reaches judgeJobChange exactly as before", async () => {
    mockFindContact.mockResolvedValue({
      ownerId: "o1",
      jobSnapshotTitle: "Dev",
      jobSnapshotCompany: "Old",
      owner: { org: { jobCheckEnabled: true } },
    });

    await handleScrapeProfile(scrapeTask());

    expect(mockJudge).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Dana Cohen",
        prevTitle: "Dev",
        newTitle: "CTO",
        prevCompany: "Old",
        newCompany: "New",
      })
    );
  });
});
