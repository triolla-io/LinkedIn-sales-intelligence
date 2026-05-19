import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/inngest/client", () => ({ inngest: { send: sendMock } }));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockCampaignFindFirst = vi.hoisted(() => vi.fn());
const mockCampaignUpdate = vi.hoisted(() => vi.fn());
const mockCampaignUpdateMany = vi.hoisted(() => vi.fn());
const mockRecipientFindMany = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockLinkedinSessionFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findFirst: mockCampaignFindFirst, update: mockCampaignUpdate, updateMany: mockCampaignUpdateMany },
    campaignRecipient: { findMany: mockRecipientFindMany },
    user: { findUnique: mockUserFindUnique },
    linkedinSession: { findUnique: mockLinkedinSessionFindUnique },
  },
}));

import { POST as startRoute } from "@/app/api/campaigns/[id]/start/route";
import { POST as pauseRoute } from "@/app/api/campaigns/[id]/pause/route";
import { POST as resumeRoute } from "@/app/api/campaigns/[id]/resume/route";
import { POST as cancelRoute } from "@/app/api/campaigns/[id]/cancel/route";

const ORG = { id: "org1", name: "TestOrg" };
const USER = { id: "user1", orgId: "org1", email: "a@x.com", name: "U", role: "SALESPERSON", org: ORG };

function makeReq() {
  return new NextRequest("http://localhost/api/campaigns/camp1/start", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({});
  mockCampaignUpdate.mockResolvedValue({});
  mockCampaignUpdateMany.mockResolvedValue({ count: 1 });
  mockRecipientFindMany.mockResolvedValue([]);
  mockAuth.mockResolvedValue({ user: { id: "user1" } });
  mockUserFindUnique.mockResolvedValue(USER);
  mockLinkedinSessionFindUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
});

describe("start route", () => {
  it("transitions DRAFT -> QUEUED and emits campaign.start", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: "camp1", ownerId: "user1", status: "DRAFT" });
    const res = await startRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "QUEUED" } }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.start" }));
  });

  it("returns 409 if not DRAFT", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: "camp1", status: "RUNNING" });
    const res = await startRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(409);
  });
});

describe("pause route", () => {
  it("transitions RUNNING -> PAUSED", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: "camp1", ownerId: "user1", status: "RUNNING" });
    const res = await pauseRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PAUSED" } }));
  });
});

describe("resume route", () => {
  it("transitions PAUSED -> RUNNING and re-emits pending recipients", async () => {
    mockCampaignUpdateMany.mockResolvedValue({ count: 1 });
    mockRecipientFindMany.mockResolvedValue([{ id: "rec1" }]);
    const res = await resumeRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(200);
    expect(mockCampaignUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "RUNNING" } }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ name: "campaign.send-one" }));
  });

  it("returns 409 if campaign not PAUSED or not found", async () => {
    mockCampaignUpdateMany.mockResolvedValue({ count: 0 });
    const res = await resumeRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(409);
  });
});

describe("cancel route", () => {
  it("cancels a RUNNING campaign", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: "camp1", ownerId: "user1", status: "RUNNING" });
    const res = await cancelRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
  });

  it("returns 409 if already CANCELLED", async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: "camp1", status: "CANCELLED" });
    const res = await cancelRoute(makeReq(), { params: Promise.resolve({ id: "camp1" }) });
    expect(res.status).toBe(409);
  });
});
