import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/extension/token";
import { POST } from "@/app/api/extension/tasks/[id]/result/route";
import { NextRequest } from "next/server";
import { inngest } from "@/inngest/client";

vi.mock("@/inngest/client", () => ({
  inngest: { send: vi.fn().mockResolvedValue({}) },
}));

async function setup() {
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.create({
    data: { email: `t-${Date.now()}@x.com`, name: "T", orgId: org.id },
  });
  const { raw, hash, prefix } = generateToken();
  await prisma.extensionSession.create({ data: { userId: user.id, tokenHash: hash, tokenPrefix: prefix } });
  const task = await prisma.extensionTask.create({
    data: { userId: user.id, kind: "SEND", payload: {}, status: "CLAIMED", claimedAt: new Date() },
  });
  return { user, token: raw, task };
}

function makeReq(token: string, body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/extension/tasks/[id]/result", () => {
  it("marks task DONE and emits inngest event on success", async () => {
    const { token, task } = await setup();
    const res = await POST(makeReq(token, { ok: true, result: { sentAt: new Date().toISOString() } }), {
      params: Promise.resolve({ id: task.id }),
    });
    expect(res.status).toBe(200);
    const reloaded = await prisma.extensionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloaded.status).toBe("DONE");
    expect(reloaded.completedAt).toBeTruthy();
    expect(inngest.send).toHaveBeenCalledWith(expect.objectContaining({ name: "extension.task.completed" }));
  });

  it("marks task FAILED on failure result", async () => {
    const { token, task } = await setup();
    const res = await POST(
      makeReq(token, { ok: false, errorCode: "selector_missing", errorMessage: "boom" }),
      { params: Promise.resolve({ id: task.id }) }
    );
    expect(res.status).toBe(200);
    const reloaded = await prisma.extensionTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(reloaded.status).toBe("FAILED");
    expect(reloaded.errorCode).toBe("selector_missing");
  });

  it("404 if task belongs to other user", async () => {
    const a = await setup();
    const b = await setup();
    const res = await POST(makeReq(b.token, { ok: true }), { params: Promise.resolve({ id: a.task.id }) });
    expect(res.status).toBe(404);
  });
});
