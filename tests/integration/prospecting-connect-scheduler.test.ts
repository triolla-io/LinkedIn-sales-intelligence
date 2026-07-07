import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { queueNextConnect, rescheduleRunPendingConnect } from "@/lib/prospecting/connect-scheduler";

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

function jerusalemWeekdayNow(): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(new Date());
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd]!;
}

async function makeRunWithWindow(window: { sendDays: number[]; sendHoursStart: number; sendHoursEnd: number }) {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: { email: `sw-${Date.now()}-${Math.random()}@x.com`, name: "T", orgId: org.id },
  });
  const run = await prisma.prospectingRun.create({
    data: { ownerId: user.id, name: "r", keywords: "cto", searchUrl: "x", status: "RUNNING", dailyCap: 8, ...window },
  });
  await prisma.connectionRequest.create({
    data: { ownerId: user.id, runId: run.id, linkedinUrn: `u-${Math.random()}`, linkedinUrl: "u", status: "DISCOVERED" },
  });
  return run;
}

describe("send window scheduling", () => {
  it("schedules outside-today runs for a later day (run sendDays respected)", async () => {
    const today = jerusalemWeekdayNow();
    const run = await makeRunWithWindow({
      sendDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today),
      sendHoursStart: 9,
      sendHoursEnd: 18,
    });
    await queueNextConnect(run.id);
    const task = await prisma.extensionTask.findFirstOrThrow({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    // Today is excluded → the task must land on a later day, hours away at minimum.
    expect(task.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 2 * 60 * 60 * 1000);
  });

  it("schedules immediately inside an always-open window", async () => {
    const run = await makeRunWithWindow({ sendDays: [0, 1, 2, 3, 4, 5, 6], sendHoursStart: 0, sendHoursEnd: 24 });
    await queueNextConnect(run.id);
    const task = await prisma.extensionTask.findFirstOrThrow({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    expect(task.scheduledFor.getTime()).toBeLessThan(Date.now() + 60 * 60 * 1000);
  });

  it("rescheduleRunPendingConnect moves a pending task out of a now-excluded day", async () => {
    const run = await makeRunWithWindow({ sendDays: [0, 1, 2, 3, 4, 5, 6], sendHoursStart: 0, sendHoursEnd: 24 });
    await queueNextConnect(run.id);
    const before = await prisma.extensionTask.findFirstOrThrow({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    // Narrow the window to exclude today, as PATCH will do.
    const today = jerusalemWeekdayNow();
    await prisma.prospectingRun.update({
      where: { id: run.id },
      data: { sendDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today) },
    });
    await rescheduleRunPendingConnect(run.id);
    const after = await prisma.extensionTask.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 2 * 60 * 60 * 1000);
  });

  it("rescheduleRunPendingConnect is a no-op when the task is already inside the window", async () => {
    const run = await makeRunWithWindow({ sendDays: [0, 1, 2, 3, 4, 5, 6], sendHoursStart: 0, sendHoursEnd: 24 });
    await queueNextConnect(run.id);
    const before = await prisma.extensionTask.findFirstOrThrow({
      where: { prospectingRunId: run.id, kind: "CONNECT" },
    });
    await rescheduleRunPendingConnect(run.id);
    const after = await prisma.extensionTask.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.scheduledFor.getTime()).toBe(before.scheduledFor.getTime());
  });

  it("does not pull a quota-deferred task forward when the window is edited", async () => {
    const run = await makeRunWithWindow({ sendDays: [0, 1, 2, 3, 4, 5, 6], sendHoursStart: 0, sendHoursEnd: 24 });
    // Saturate the weekly cap for this owner so the task gets quota-deferred.
    const { ownerId } = await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id }, select: { ownerId: true } });
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { weeklyCap: 1, dailyCap: 1 } });
    await prisma.connectionRequest.create({
      data: { ownerId, runId: run.id, linkedinUrn: `sent-${Math.random()}`, linkedinUrl: "u", status: "SENT", sentAt: new Date() },
    });
    await queueNextConnect(run.id);
    const before = await prisma.extensionTask.findFirstOrThrow({ where: { prospectingRunId: run.id, kind: "CONNECT" } });
    // Deferred ~7 days out (weekly cap). Now exclude the deferred task's own weekday — must NOT pull forward.
    const deferredDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(before.scheduledFor);
    const deferredWeekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[deferredDay]!;
    await prisma.prospectingRun.update({ where: { id: run.id }, data: { sendDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== deferredWeekday) } });
    await rescheduleRunPendingConnect(run.id);
    const after = await prisma.extensionTask.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.scheduledFor.getTime()).toBe(before.scheduledFor.getTime());
  });
});

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
