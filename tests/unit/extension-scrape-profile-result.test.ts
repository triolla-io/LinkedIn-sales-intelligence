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
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old" });
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
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old" });
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

  it("old extension result with only title/company still stamps profileScrapedAt but leaves about/experience/headline untouched", async () => {
    mockFindContact.mockResolvedValue({ ownerId: "o1", jobSnapshotTitle: "Dev", jobSnapshotCompany: "Old" });
    const task = { userId: "o1", payload: { contactId: "c1" }, result: { title: "CTO", company: "New" } };
    await handleScrapeProfile(task as never);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { profileScrapedAt: expect.any(Date) },
    });
  });
});
