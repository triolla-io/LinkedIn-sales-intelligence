import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (req: unknown, ctx: { effectiveUserId: string }) => unknown) => (req: unknown) => h(req, { effectiveUserId: "owner1" }),
}));
const articleFindMany = vi.fn();
const matchFindFirst = vi.fn();
const matchUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fintechArticle: { findMany: (...a: unknown[]) => articleFindMany(...a) },
    articleMatch: {
      findFirst: (...a: unknown[]) => matchFindFirst(...a),
      update: (...a: unknown[]) => matchUpdate(...a),
    },
  },
}));

import { GET } from "@/app/api/fintech-radar/route";
import { PATCH } from "@/app/api/fintech-radar/[matchId]/route";

function reqWith(matchId: string, body: unknown) {
  return {
    nextUrl: { pathname: `/api/fintech-radar/${matchId}` },
    json: async () => body,
  } as unknown as Request;
}

beforeEach(() => {
  articleFindMany.mockReset();
  matchFindFirst.mockReset();
  matchUpdate.mockReset();
});

describe("GET /api/fintech-radar", () => {
  it("returns the caller's suggested matches grouped by article", async () => {
    articleFindMany.mockResolvedValue([
      { id: "a1", title: "T", summary: "S", url: "https://x/a", source: "fintech-radar", publishedAt: null,
        matches: [{ id: "m1", score: 0.8, reason: "r", draftMessage: "hi", contact: { fullName: "Y", currentTitle: "CFO", email: "y@x.com", phone: null, linkedinUrl: "https://li/y" } }] },
    ]);
    const res = await GET(new Request("http://x/api/fintech-radar") as never);
    const json = await (res as Response).json();
    expect(json.articles).toHaveLength(1);
    expect(json.articles[0].matches[0].contact.email).toBe("y@x.com");
    // must scope matches to ownerId
    expect(articleFindMany.mock.calls[0][0].where.matches.some.ownerId).toBe("owner1");
    // must exclude undrafted matches (draftMessage still null) in both the outer filter and the nested select
    expect(articleFindMany.mock.calls[0][0].where.matches.some.draftMessage).toEqual({ not: null });
    expect(articleFindMany.mock.calls[0][0].select.matches.where.draftMessage).toEqual({ not: null });
  });
});

describe("PATCH /api/fintech-radar/[matchId]", () => {
  it("returns 404 when the match is not owned by the caller, and does not update", async () => {
    matchFindFirst.mockResolvedValue(null);
    const res = await PATCH(reqWith("m1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(404);
    const json = await (res as Response).json();
    expect(json.error).toBe("not_found");
    expect(matchUpdate).not.toHaveBeenCalled();
    // tenancy pin: findFirst must scope by ownerId
    expect(matchFindFirst.mock.calls[0][0].where.ownerId).toBe("owner1");
  });

  it("dismiss sets status to DISMISSED", async () => {
    matchFindFirst.mockResolvedValue({ id: "m1" });
    const res = await PATCH(reqWith("m1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(200);
    const json = await (res as Response).json();
    expect(json.ok).toBe(true);
    expect(matchUpdate).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "DISMISSED" } });
  });

  it("rejects save with an empty (whitespace-only) message", async () => {
    matchFindFirst.mockResolvedValue({ id: "m1" });
    const res = await PATCH(reqWith("m1", { action: "save", message: "   " }) as never);
    expect((res as Response).status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toBe("empty_message");
    expect(matchUpdate).not.toHaveBeenCalled();
  });

  it("rejects save with a non-string message", async () => {
    matchFindFirst.mockResolvedValue({ id: "m1" });
    const res = await PATCH(reqWith("m1", { action: "save", message: 123 }) as never);
    expect((res as Response).status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toBe("empty_message");
    expect(matchUpdate).not.toHaveBeenCalled();
  });

  it("rejects sent with an invalid channel", async () => {
    matchFindFirst.mockResolvedValue({ id: "m1" });
    const res = await PATCH(reqWith("m1", { action: "sent", channel: "telegram" }) as never);
    expect((res as Response).status).toBe(400);
    const json = await (res as Response).json();
    expect(json.error).toBe("invalid_channel");
    expect(matchUpdate).not.toHaveBeenCalled();
  });

  it("sent with a valid channel sets status SENT and sentChannel", async () => {
    matchFindFirst.mockResolvedValue({ id: "m1" });
    const res = await PATCH(reqWith("m1", { action: "sent", channel: "whatsapp" }) as never);
    expect((res as Response).status).toBe(200);
    const json = await (res as Response).json();
    expect(json.ok).toBe(true);
    expect(matchUpdate).toHaveBeenCalledWith({ where: { id: "m1" }, data: { status: "SENT", sentChannel: "whatsapp" } });
  });
});
