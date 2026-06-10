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

describe("ProspectingRun schedule fields", () => {
  it("run created with custom hours and days persists those values", async () => {
    const org = await prisma.organization.findFirstOrThrow();
    const user = await prisma.user.create({
      data: { email: `sched-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
    });
    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: user.id,
        name: "custom-hours",
        keywords: "cto",
        searchUrl: "x",
        sendHoursStart: 8,
        sendHoursEnd: 17,
        sendDays: [1, 2, 3, 4, 5],
      },
    });
    expect(run.sendHoursStart).toBe(8);
    expect(run.sendHoursEnd).toBe(17);
    expect(run.sendDays).toEqual([1, 2, 3, 4, 5]);
  });

  it("run created without schedule fields gets defaults 9/18/[]", async () => {
    const org = await prisma.organization.findFirstOrThrow();
    const user = await prisma.user.create({
      data: { email: `sched2-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
    });
    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: user.id,
        name: "defaults",
        keywords: "cto",
        searchUrl: "x",
      },
    });
    expect(run.sendHoursStart).toBe(9);
    expect(run.sendHoursEnd).toBe(18);
    expect(run.sendDays).toEqual([]);
  });

  it("queueNextConnect uses run sendDays — task scheduledFor lands on a Mon–Fri day when sendDays is [1,2,3,4,5]", async () => {
    const org = await prisma.organization.findFirstOrThrow();
    const user = await prisma.user.create({
      data: {
        email: `sched3-${Date.now()}-${Math.random()}@x.com`,
        name: "T",
        orgId: org.id,
        timezone: "UTC",
      },
    });
    // sendHoursStart: 0, sendHoursEnd: 24 → always "in working hours"
    // sendDays: [1,2,3,4,5] → Mon–Fri only
    const run = await prisma.prospectingRun.create({
      data: {
        ownerId: user.id,
        name: "weekdays-only",
        keywords: "cto",
        searchUrl: "x",
        status: "RUNNING",
        dailyCap: 8,
        sendHoursStart: 0,
        sendHoursEnd: 24,
        sendDays: [1, 2, 3, 4, 5],
      },
    });
    await prisma.connectionRequest.create({
      data: {
        ownerId: user.id,
        runId: run.id,
        linkedinUrn: `u-wd-${Math.random()}`,
        linkedinUrl: "u",
        status: "DISCOVERED",
      },
    });
    await queueNextConnect(run.id);
    const task = await prisma.extensionTask.findFirst({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
      select: { scheduledFor: true },
    });
    expect(task).not.toBeNull();
    // scheduledFor must land on Mon–Fri (UTC weekday 1–5)
    const dayOfWeek = task!.scheduledFor.getUTCDay();
    expect([1, 2, 3, 4, 5]).toContain(dayOfWeek);
  });
});
