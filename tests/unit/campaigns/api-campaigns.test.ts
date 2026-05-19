import { describe, it, expect, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockCampaignCreate = vi.hoisted(() => vi.fn());
const mockCampaignFindMany = vi.hoisted(() => vi.fn());
const mockCampaignFindFirst = vi.hoisted(() => vi.fn());
const mockTemplateFindFirst = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { create: mockCampaignCreate, findMany: mockCampaignFindMany, findFirst: mockCampaignFindFirst },
    messageTemplate: { findFirst: mockTemplateFindFirst },
    user: { findUnique: mockUserFindUnique },
  },
}));

import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/campaigns/route";

const ORG = { id: "org1", name: "TestOrg" };
const USER = { id: "user1", orgId: "org1", email: "a@x.com", name: "U", role: "SALESPERSON", org: ORG };

function makeReq(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/campaigns", {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : {},
  });
}

describe("POST /api/campaigns", () => {
  it("creates a draft campaign", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
    mockTemplateFindFirst.mockResolvedValue({ id: "tpl1", name: "T", body: "Hi" });
    mockCampaignCreate.mockResolvedValue({ id: "camp1", status: "DRAFT", channel: "LINKEDIN" });

    const res = await POST(makeReq("POST", { name: "Test", templateId: "tpl1", contactIds: ["c1"] }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.campaign.status).toBe("DRAFT");
  });

  it("returns 400 when name missing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
    const res = await POST(makeReq("POST", { templateId: "tpl1" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/campaigns", () => {
  it("lists campaigns for the tenant", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    mockUserFindUnique.mockResolvedValue(USER);
    mockCampaignFindMany.mockResolvedValue([]);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.campaigns)).toBe(true);
  });
});
