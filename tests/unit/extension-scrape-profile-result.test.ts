import { describe, it, expect, vi, beforeEach } from "vitest";
const mockRecord = vi.fn();
const mockFindContact = vi.fn();
vi.mock("@/lib/job-check/detect-change", () => ({ recordJobChangeIfAny: (...a: unknown[]) => mockRecord(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { contact: { findUnique: (...a: unknown[]) => mockFindContact(...a) } } }));
import { handleScrapeProfile } from "@/inngest/functions/extension-task-result";
beforeEach(() => { mockRecord.mockReset(); mockFindContact.mockReset(); });
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
});
