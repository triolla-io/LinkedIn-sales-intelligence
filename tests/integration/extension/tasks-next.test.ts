import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/extension/token";
import { GET } from "@/app/api/extension/tasks/next/route";
import { NextRequest } from "next/server";

async function setupUserWithToken() {
  const user = await prisma.user.create({
    data: { email: `t-${Date.now()}@x.com`, name: "T", orgId: (await prisma.organization.findFirstOrThrow()).id },
  });
  const { raw, hash, prefix } = generateToken();
  await prisma.extensionSession.create({ data: { userId: user.id, tokenHash: hash, tokenPrefix: prefix } });
  return { user, token: raw };
}

function makeReq(token: string) {
  return new NextRequest("http://localhost/api/extension/tasks/next", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("GET /api/extension/tasks/next", () => {
  it("returns 204 when no pending tasks", async () => {
    const { token } = await setupUserWithToken();
    const res = await GET(makeReq(token));
    expect(res.status).toBe(204);
  });

  it("returns and CLAIMs the next due PENDING task", async () => {
    const { user, token } = await setupUserWithToken();
    const t = await prisma.extensionTask.create({
      data: {
        userId: user.id,
        kind: "SEND",
        payload: { linkedinUrl: "https://linkedin.com/in/x", text: "hi" },
        scheduledFor: new Date(Date.now() - 1000),
      },
    });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(t.id);
    const reloaded = await prisma.extensionTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(reloaded.status).toBe("CLAIMED");
    expect(reloaded.claimedAt).toBeTruthy();
  });

  it("does not return tasks scheduled in the future", async () => {
    const { user, token } = await setupUserWithToken();
    await prisma.extensionTask.create({
      data: { userId: user.id, kind: "SEND", payload: {}, scheduledFor: new Date(Date.now() + 60_000) },
    });
    const res = await GET(makeReq(token));
    expect(res.status).toBe(204);
  });

  it("concurrent claims only succeed once", async () => {
    const { user, token } = await setupUserWithToken();
    await prisma.extensionTask.create({
      data: { userId: user.id, kind: "SEND", payload: {}, scheduledFor: new Date(Date.now() - 1000) },
    });
    const [a, b] = await Promise.all([GET(makeReq(token)), GET(makeReq(token))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 204]);
  });
});
