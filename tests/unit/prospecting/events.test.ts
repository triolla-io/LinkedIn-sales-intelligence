import { describe, it, expect, vi, afterEach } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { prospectingEvent: { create: (a: unknown) => createMock(a) } } }));

import { logProspectingEvent } from "@/lib/prospecting/events";

afterEach(() => createMock.mockReset());

describe("logProspectingEvent", () => {
  it("writes a row with the given fields", async () => {
    createMock.mockResolvedValue({});
    await logProspectingEvent({ runId: "r1", type: "QUEUED", connectionRequestId: "c1", message: "hi", detail: { a: 1 } });
    expect(createMock).toHaveBeenCalledWith({
      data: { runId: "r1", type: "QUEUED", connectionRequestId: "c1", message: "hi", detail: { a: 1 } },
    });
  });

  it("never throws even if the DB write fails", async () => {
    createMock.mockRejectedValue(new Error("db down"));
    await expect(logProspectingEvent({ runId: "r1", type: "SENT" })).resolves.toBeUndefined();
  });
});
