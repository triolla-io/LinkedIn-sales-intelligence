import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const runFindFirst = vi.hoisted(() => vi.fn());
const runUpdate = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());
const insertTargets = vi.hoisted(() => vi.fn());
const inngestSend = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/inngest/client", () => ({ inngest: { send: inngestSend } }));
vi.mock("@/lib/prospecting/company-targets", () => ({
  insertCompanyTargets: insertTargets,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prospectingRun: { findFirst: runFindFirst, update: runUpdate },
    user: { findUnique: userFindUnique, findUniqueOrThrow: userFindUnique },
  },
}));

const USER = {
  id: "user1",
  orgId: "org1",
  role: "SALESPERSON",
  routineConnectionsEnabled: true,
  org: { id: "org1", name: "Org" },
};

function jsonReq(body: unknown) {
  return new NextRequest("http://test/api/prospecting/runs/run1/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/prospecting/runs/[id]/companies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user1" } });
    userFindUnique.mockResolvedValue(USER);
    insertTargets.mockResolvedValue({
      added: 1,
      skippedExisting: 1,
      skippedInvalid: 0,
    });
  });

  it("adds JSON companies and returns dedup counts", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "DRAFT",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/companies/route");
    const res = await POST(
      jsonReq({ companies: [{ name: "Acme" }, { name: "Acme" }] }),
      {
        params: Promise.resolve({ id: "run1" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      added: 1,
      skippedExisting: 1,
      skippedInvalid: 0,
    });
    expect(runUpdate).not.toHaveBeenCalled();
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("reactivates a COMPLETED run when new companies arrive", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "COMPLETED",
      targetType: "COMPANY",
      discoveryDone: true,
    });
    runUpdate.mockResolvedValue({});
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/companies/route");
    const res = await POST(jsonReq({ companies: [{ name: "New Co" }] }), {
      params: Promise.resolve({ id: "run1" }),
    });
    expect(res.status).toBe(200);
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: "run1" },
      data: { status: "RUNNING", discoveryDone: false, completedAt: null },
    });
    expect(inngestSend).toHaveBeenCalledWith({
      name: "prospecting.start",
      data: { runId: "run1" },
    });
  });

  it("parses an uploaded CSV file (multipart)", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "DRAFT",
      targetType: "COMPANY",
      discoveryDone: false,
    });
    // jsdom's File/FormData do not round-trip through undici's multipart parser
    // (webidl File check fails), so we stub r.formData() to return the file-like
    // object the parser would have produced and exercise the real route +
    // parseCompaniesFile logic on top of it.
    const csv =
      "name,linkedin\nAcme,https://www.linkedin.com/company/acme\n,,\n";
    const file = {
      name: "companies.csv",
      type: "text/csv",
      text: async () => csv,
      arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
    };
    const req = new NextRequest(
      "http://test/api/prospecting/runs/run1/companies",
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=----x",
        },
      },
    );
    Object.defineProperty(req, "formData", {
      configurable: true,
      value: async () => ({ get: (k: string) => (k === "file" ? file : null) }),
    });
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/companies/route");
    const res = await POST(req, { params: Promise.resolve({ id: "run1" }) });
    expect(res.status).toBe(200);
    expect(insertTargets).toHaveBeenCalledWith(
      "run1",
      [expect.objectContaining({ name: "Acme", linkedinSlug: "acme" })],
      1,
    );
  });

  it("rejects non-COMPANY runs", async () => {
    runFindFirst.mockResolvedValue({
      id: "run1",
      status: "DRAFT",
      targetType: "KEYWORDS",
      discoveryDone: false,
    });
    const { POST } =
      await import("@/app/api/prospecting/runs/[id]/companies/route");
    const res = await POST(jsonReq({ companies: [{ name: "Acme" }] }), {
      params: Promise.resolve({ id: "run1" }),
    });
    expect(res.status).toBe(409);
  });
});
