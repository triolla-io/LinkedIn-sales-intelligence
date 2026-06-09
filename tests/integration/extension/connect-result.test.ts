import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { extensionTaskResultHandler } from "@/inngest/functions/extension-task-result";

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({}),
    createFunction: vi.fn().mockReturnValue({}),
  },
}));

async function scenario(errorCode: string) {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: { email: `cr-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
  });
  const run = await prisma.prospectingRun.create({
    data: {
      ownerId: user.id, name: "r", keywords: "cto", searchUrl: "x",
      status: "RUNNING", connectInFlight: true, totalSent: 0,
    },
  });
  const cr = await prisma.connectionRequest.create({
    data: {
      ownerId: user.id, runId: run.id,
      linkedinUrn: `urn-${Math.random()}`, linkedinUrl: "u", status: "QUEUED",
    },
  });
  const task = await prisma.extensionTask.create({
    data: {
      userId: user.id, kind: "CONNECT", status: "FAILED", payload: {},
      prospectingRunId: run.id, connectionRequestId: cr.id, errorCode,
    },
  });
  await extensionTaskResultHandler({ event: { data: { taskId: task.id, ok: false, errorCode } } });
  return {
    cr: await prisma.connectionRequest.findUniqueOrThrow({ where: { id: cr.id } }),
    run: await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id } }),
  };
}

describe("CONNECT already-pending/connected handling", () => {
  it("marks already_pending as SENT and releases the slot", async () => {
    const { cr, run } = await scenario("already_pending");
    expect(cr.status).toBe("SENT");
    expect(run.totalSent).toBe(1);
    expect(run.connectInFlight).toBe(false);
  });
  it("marks already_connected as SENT", async () => {
    const { cr } = await scenario("already_connected");
    expect(cr.status).toBe("SENT");
  });
  it("still marks a genuine failure as FAILED", async () => {
    const { cr } = await scenario("no_connect");
    expect(cr.status).toBe("FAILED");
  });
});
