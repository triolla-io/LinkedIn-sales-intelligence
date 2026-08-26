import { describe, it, expect, vi, beforeEach } from "vitest";
const mockRecord = vi.fn();
const mockFindContact = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/job-check/detect-change", () => ({ recordJobChangeIfAny: (...a: unknown[]) => mockRecord(...a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findUnique: (...a: unknown[]) => mockFindContact(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
  },
}));
import { handleScrapeProfile } from "@/inngest/functions/extension-task-result";
beforeEach(() => { mockRecord.mockReset(); mockFindContact.mockReset(); mockUpdate.mockReset(); });
describe("handleScrapeProfile", () => {
  it("feeds scraped title/company + stored snapshot into recordJobChangeIfAny", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old", owner: { org: { jobCheckEnabled: true } } });
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New" } };
    await handleScrapeProfile(task as never);
    expect(mockRecord).toHaveBeenCalledWith({
      contactId: "c1", ownerId: "o1", snapshotTitle: "Dev", snapshotCompany: "Old", freshTitle: "CTO", freshCompany: "New",
    });
  });
  it("no-ops when contactId is missing", async () => {
    await handleScrapeProfile({ payload: {}, result: {} } as never);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("first run (null snapshot) seeds the baseline and does NOT record a change", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: null, jobSnapshotCompany: null });
    await handleScrapeProfile({ payload: { contactId: "c1" }, result: { title: "CTO", company: "New" } } as never);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "c1" },
      data: expect.objectContaining({ jobSnapshotTitle: "CTO", jobSnapshotCompany: "New" }),
    }));
  });

  it("markScrapeProfileChecked advances lastJobCheckAt on FAILED", async () => {
    const { markScrapeProfileChecked } = await import("@/inngest/functions/extension-task-result");
    await markScrapeProfileChecked({ payload: { contactId: "c9" } } as never);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "c9" },
      data: expect.objectContaining({ lastJobCheckAt: expect.any(Date) }),
    }));
  });

  it("writes headline/about/experience + profileScrapedAt from a richer scrape, and still runs the unchanged jobSnapshot logic", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old", owner: { org: { jobCheckEnabled: true } } });
    const experience = [{ title: "CTO", company: "New", dateRange: "2024-Present" }];
    const task = {
      userId: "o1",
      payload: { contactId: "c1" },
      result: { title: "CTO", company: "New", headline: "CTO @ New", about: "Builds things.", experience },
    };
    await handleScrapeProfile(task as never);
    // Layer-4 write: raw profile fields land regardless of the job-change branch below.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: {
        profileScrapedAt: expect.any(Date),
        headline: "CTO @ New",
        about: "Builds things.",
        experience,
      },
    });
    // jobSnapshot logic is untouched: same snapshot present -> recordJobChangeIfAny still runs.
    expect(mockRecord).toHaveBeenCalledWith({
      contactId: "c1", ownerId: "o1", snapshotTitle: "Dev", snapshotCompany: "Old", freshTitle: "CTO", freshCompany: "New",
    });
  });

  /**
   * The radar's SCRAPE_PROFILE source (dispatch.ts) is gated on radarInclude alone, not
   * Org.jobCheckEnabled — so this function can now run for an org that switched "Job
   * Changes" off. The profile-fields write must still happen (that's the radar's own
   * data and costs nothing); recordJobChangeIfAny (which wraps the paid judgeJobChange
   * call) must not. The real LLM boundary is asserted directly in
   * extension-scrape-profile-org-gate.test.ts, which doesn't mock recordJobChangeIfAny
   * away — this test just pins the shape of the call this file already mocks.
   */
  it("writes the profile fields but skips recordJobChangeIfAny when the org has jobCheckEnabled: false", async () => {
    mockFindContact.mockResolvedValue({
      ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old",
      owner: { org: { jobCheckEnabled: false } },
    });
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New" } };
    await handleScrapeProfile(task as never);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { profileScrapedAt: expect.any(Date) },
    });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("old extension result with only title/company still stamps profileScrapedAt but leaves about/experience/headline untouched", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old", owner: { org: { jobCheckEnabled: true } } });
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New" } };
    await handleScrapeProfile(task as never);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { profileScrapedAt: expect.any(Date) },
    });
  });

  it("truncates an oversized about to exactly 2000 chars", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old", owner: { org: { jobCheckEnabled: true } } });
    const longAbout = "a".repeat(2500);
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New", about: longAbout } };
    await handleScrapeProfile(task as never);
    const call = mockUpdate.mock.calls.find((c) => c[0]?.data?.about !== undefined);
    expect(call).toBeDefined();
    expect(call![0].data.about).toHaveLength(2000);
    expect(call![0].data.about).toBe(longAbout.slice(0, 2000));
  });

  it("truncates an oversized experience array to exactly 5 entries", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old", owner: { org: { jobCheckEnabled: true } } });
    const experience = Array.from({ length: 7 }, (_, i) => ({
      title: `Role ${i}`, company: `Co ${i}`, dateRange: `20${10 + i}-20${11 + i}`,
    }));
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New", experience } };
    await handleScrapeProfile(task as never);
    const call = mockUpdate.mock.calls.find((c) => c[0]?.data?.experience !== undefined);
    expect(call).toBeDefined();
    expect(call![0].data.experience).toHaveLength(5);
    expect(call![0].data.experience).toEqual(experience.slice(0, 5));
  });
});
