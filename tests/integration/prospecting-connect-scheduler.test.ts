import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { queueNextConnect } from "@/lib/prospecting/connect-scheduler";

async function makeRun() {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: { email: `sch-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
  });
  const run = await prisma.prospectingRun.create({
    data: { ownerId: user.id, name: "r", keywords: "cto", searchUrl: "x", status: "RUNNING", dailyCap: 8 },
  });
  for (let i = 0; i < 3; i++) {
    await prisma.connectionRequest.create({
      data: {
        ownerId: user.id, runId: run.id,
        linkedinUrn: `u-${Math.random()}`, linkedinUrl: "u", status: "DISCOVERED",
      },
    });
  }
  return run;
}

describe("queueNextConnect single-in-flight", () => {
  it("never creates a 2nd CONNECT task while one is live", async () => {
    const run = await makeRun();
    const first = await queueNextConnect(run.id);
    expect(first).toBeTruthy();
    // Slot is held; a second call must NOT create another CONNECT task.
    const second = await queueNextConnect(run.id);
    expect(second).toBeNull();
    const count = await prisma.extensionTask.count({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    expect(count).toBe(1);
  });

  it("does not create a duplicate even if connectInFlight was wrongly left false", async () => {
    const run = await makeRun();
    await queueNextConnect(run.id);
    // Simulate a stale/raced flag reset while the PENDING task still exists.
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { connectInFlight: false } });
    const again = await queueNextConnect(run.id);
    expect(again).toBeNull();
    const count = await prisma.extensionTask.count({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    expect(count).toBe(1);
  });
});
