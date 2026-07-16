import { describe, it, expect, vi } from "vitest";

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue({}),
    createFunction: vi.fn().mockReturnValue({}),
  },
}));

import { prisma } from "@/lib/prisma";
import { extensionTaskResultHandler } from "@/inngest/functions/extension-task-result";
import { maybeCompleteCompanyRun } from "@/lib/prospecting/company-discovery";

async function setup() {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: {
      email: `cmp-${Date.now()}-${Math.random()}@x.com`,
      name: "T",
      orgId: org.id,
    },
  });
  const run = await prisma.prospectingRun.create({
    data: {
      ownerId: user.id,
      name: "companies",
      keywords: 'CEO, CTO, CFO, COO, CMO, Founder, Owner, מנכ"ל, סמנכ"ל',
      searchUrl: "",
      geoUrn: "",
      targetType: "COMPANY",
      status: "RUNNING",
      dailyCap: 5,
    },
  });
  const t1 = await prisma.prospectingCompanyTarget.create({
    data: {
      runId: run.id,
      name: "Acme",
      dedupKey: "acme",
      linkedinUrl: "https://www.linkedin.com/company/acme",
      linkedinSlug: "acme",
      status: "RESOLVING",
    },
  });
  const t2 = await prisma.prospectingCompanyTarget.create({
    data: { runId: run.id, name: "Globex", dedupKey: "globex" },
  });
  return { user, run, t1, t2 };
}

async function fireResult(taskId: string) {
  await extensionTaskResultHandler({ event: { data: { taskId } } });
}

describe("company run: resolve → search → next company → completion", () => {
  it("runs the full chain", async () => {
    const { user, run, t1, t2 } = await setup();

    // 1) RESOLVE_COMPANY DONE for Acme
    const resolveTask = await prisma.extensionTask.create({
      data: {
        userId: user.id,
        kind: "RESOLVE_COMPANY",
        status: "DONE",
        payload: {
          targetId: t1.id,
          linkedinUrl: t1.linkedinUrl,
          name: t1.name,
        },
        prospectingRunId: run.id,
        result: { companyId: "1441", resolvedName: "Acme Corp", slug: "acme" },
        completedAt: new Date(),
      },
    });
    await fireResult(resolveTask.id);

    const t1After = await prisma.prospectingCompanyTarget.findUniqueOrThrow({
      where: { id: t1.id },
    });
    expect(t1After.status).toBe("SEARCHING");
    expect(t1After.linkedinCompanyId).toBe("1441");
    expect(t1After.resolvedName).toBe("Acme Corp");

    const searchTask = await prisma.extensionTask.findFirstOrThrow({
      where: { prospectingRunId: run.id, kind: "SEARCH", status: "PENDING" },
    });
    const payload = searchTask.payload as {
      searchUrl: string;
      page: number;
      targetId: string;
    };
    expect(payload.targetId).toBe(t1.id);
    const url = new URL(payload.searchUrl);
    expect(url.searchParams.get("currentCompany")).toBe('["1441"]');
    expect(url.searchParams.get("network")).toBe('["S","O"]');
    expect(url.searchParams.get("geoUrn")).toBeNull();

    // 2) SEARCH DONE (last page) with one candidate
    await prisma.extensionTask.update({
      where: { id: searchTask.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        result: {
          candidates: [
            {
              urn: `urn:li:member:jane-${run.id}`,
              profileUrl: `https://www.linkedin.com/in/jane-${run.id}`,
              name: "Jane Doe",
              headline: "CEO at Acme",
              title: "CEO",
              company: "Acme",
              location: "TLV",
              degree: "2nd",
              cardAction: "connect",
            },
          ],
          hasNextPage: false,
        },
      },
    });
    await fireResult(searchTask.id);

    expect(
      (
        await prisma.prospectingCompanyTarget.findUniqueOrThrow({
          where: { id: t1.id },
        })
      ).status,
    ).toBe("DONE");
    const person = await prisma.connectionRequest.findFirstOrThrow({
      where: { runId: run.id, companyTargetId: t1.id },
    });
    expect(person.status === "DISCOVERED" || person.status === "QUEUED").toBe(
      true,
    );
    expect(
      (
        await prisma.prospectingCompanyTarget.findUniqueOrThrow({
          where: { id: t1.id },
        })
      ).discoveredCount,
    ).toBe(1);

    // Next company was scheduled with a 2–5 min humanized delay
    const nextResolve = await prisma.extensionTask.findFirstOrThrow({
      where: {
        prospectingRunId: run.id,
        kind: "RESOLVE_COMPANY",
        status: "PENDING",
      },
    });
    expect((nextResolve.payload as { targetId: string }).targetId).toBe(t2.id);
    const delay = nextResolve.scheduledFor.getTime() - Date.now();
    expect(delay).toBeGreaterThan(100_000);
    expect(delay).toBeLessThan(310_000);

    // 3) Globex resolve fails permanently → FAILED, discovery done
    await prisma.extensionTask.update({
      where: { id: nextResolve.id },
      data: {
        status: "FAILED",
        errorCode: "not_found",
        completedAt: new Date(),
      },
    });
    await fireResult(nextResolve.id);

    expect(
      (
        await prisma.prospectingCompanyTarget.findUniqueOrThrow({
          where: { id: t2.id },
        })
      ).status,
    ).toBe("FAILED");
    expect(
      (await prisma.prospectingRun.findUniqueOrThrow({ where: { id: run.id } }))
        .discoveryDone,
    ).toBe(true);

    // 4) All people terminal + no live tasks → COMPLETED
    await prisma.connectionRequest.updateMany({
      where: { runId: run.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await prisma.extensionTask.updateMany({
      where: {
        prospectingRunId: run.id,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELLED" },
    });
    await maybeCompleteCompanyRun(run.id);
    const finalRun = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(finalRun.status).toBe("COMPLETED");
    expect(finalRun.completedAt).not.toBeNull();
  }, 30_000);

  it("defers with +1h and keeps the target RESOLVING on unsupported_kind (old extension)", async () => {
    const { user, run, t1 } = await setup();
    const task = await prisma.extensionTask.create({
      data: {
        userId: user.id,
        kind: "RESOLVE_COMPANY",
        status: "FAILED",
        errorCode: "bad_payload",
        errorMessage: "unknown_kind",
        payload: {
          targetId: t1.id,
          linkedinUrl: t1.linkedinUrl,
          name: t1.name,
        },
        prospectingRunId: run.id,
        completedAt: new Date(),
      },
    });
    await extensionTaskResultHandler({ event: { data: { taskId: task.id } } });

    expect(
      (
        await prisma.prospectingCompanyTarget.findUniqueOrThrow({
          where: { id: t1.id },
        })
      ).status,
    ).toBe("RESOLVING");
    const requeued = await prisma.extensionTask.findFirstOrThrow({
      where: {
        prospectingRunId: run.id,
        kind: "RESOLVE_COMPANY",
        status: "PENDING",
      },
    });
    expect(requeued.scheduledFor.getTime()).toBeGreaterThan(
      Date.now() + 55 * 60 * 1000,
    );
    const hint = await prisma.prospectingEvent.findFirst({
      where: { runId: run.id, message: "extension_outdated" },
    });
    expect(hint).not.toBeNull();
  }, 30_000);
});
