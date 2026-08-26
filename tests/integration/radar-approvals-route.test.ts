import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The approvals payload is the morning story: pending drafts with honest chips, the
 * scan subline, and an explained quiet list. The chips must say only what the data
 * knows — factsVerified is a mechanical check against the source text, never an LLM
 * claim, and a missing scan is null (an explained empty state), never zeros.
 */

vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant:
    (h: (req: unknown, ctx: unknown) => unknown) =>
    (req: unknown) =>
      h(req, { effectiveUserId: "owner1", user: { name: "יובל כהן" }, org: { id: "org1" } }),
}));

const draftFindMany = vi.fn();
const draftGroupBy = vi.fn();
const profileFindMany = vi.fn();
const scanRunFindFirst = vi.fn();
const sentGroupBy = vi.fn();
const feedbackFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarDraft: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      groupBy: (...a: unknown[]) => draftGroupBy(...a),
    },
    personProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    radarScanRun: { findFirst: (...a: unknown[]) => scanRunFindFirst(...a) },
    sentMessage: { groupBy: (...a: unknown[]) => sentGroupBy(...a) },
    radarFeedback: { findMany: (...a: unknown[]) => feedbackFindMany(...a) },
  },
}));

const { GET } = await import("@/app/api/radar/approvals/route");

const req = { nextUrl: { pathname: "/api/radar/approvals" } } as unknown as NextRequest;

const CANON = "https://ethanolproducer.com/articles/epa-rvo-2026";

function pendingDraft(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    draftMessage: `היי אביגל, היעד עלה ל-24.02 מיליארד גלון ${CANON}`,
    whyHim: "זו החלטה שלו",
    createdAt: new Date("2026-08-24T05:00:00Z"),
    contact: { id: "ct1", fullName: "Avigal Soreq", currentTitle: "CEO", currentCompany: "Delek US", linkedinUrl: "https://linkedin.com/in/avigal" },
    item: {
      title: "EPA finalizes RVOs",
      summary: "EPA set targets of 24.02 billion gallons",
      sources: [{ url: CANON, title: "EPA finalizes", publishedAt: "2026-08-23T00:00:00Z" }],
      publishedAt: new Date("2026-08-23T00:00:00Z"),
      createdAt: new Date("2026-08-23T10:00:00Z"),
    },
    ...over,
  };
}

beforeEach(() => {
  for (const m of [draftFindMany, draftGroupBy, profileFindMany, scanRunFindFirst, sentGroupBy, feedbackFindMany]) m.mockReset();
  draftFindMany.mockResolvedValue([]);
  draftGroupBy.mockResolvedValue([]);
  profileFindMany.mockResolvedValue([]);
  scanRunFindFirst.mockResolvedValue(null);
  sentGroupBy.mockResolvedValue([]);
  feedbackFindMany.mockResolvedValue([]);
});

describe("GET /api/radar/approvals", () => {
  it("asks only for the effective user's open drafts — mid-prepare cards stay visible", async () => {
    await GET(req);
    expect(draftFindMany.mock.calls[0][0].where).toMatchObject({
      ownerId: "owner1",
      status: { in: ["PENDING_REVIEW", "PREPARING", "PREPARED"] },
    });
  });

  it("factsVerified is true only when every figure appears in the source text", async () => {
    draftFindMany.mockResolvedValue([
      pendingDraft(),
      pendingDraft({ id: "d2", draftMessage: `היעד עלה ל-97 מיליארד ${CANON}` }),
    ]);
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.drafts.find((d: { id: string }) => d.id === "d1").factsVerified).toBe(true);
    expect(body.drafts.find((d: { id: string }) => d.id === "d2").factsVerified).toBe(false);
  });

  it("a message with no figures gets no verified chip — there is nothing to verify", async () => {
    draftFindMany.mockResolvedValue([pendingDraft({ draftMessage: "נתקלתי במשהו שחשבתי עליך" })]);
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.drafts[0].factsVerified).toBe(false);
  });

  /**
   * A contact's extra channels ride along on the card, so the client can offer "שלח
   * בוואטסאפ" for the people whose relationship supports it (channels=["whatsapp"]).
   * The default — empty channels — keeps the card LinkedIn-only.
   */
  it("carries the contact's phone and channels for the WhatsApp button", async () => {
    draftFindMany.mockResolvedValue([
      pendingDraft({
        contact: {
          id: "ct1", fullName: "Erez Rachmil", currentTitle: "CITO", currentCompany: "Bank Hapoalim",
          linkedinUrl: "https://linkedin.com/in/erezrachmil",
          phone: "+972501234567", channels: ["whatsapp"],
        },
      }),
    ]);
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.drafts[0].contact.phone).toBe("+972501234567");
    expect(body.drafts[0].contact.channels).toEqual(["whatsapp"]);
    // The response maps the contact through verbatim, so the proof that these fields
    // actually arrive is the SELECT itself — not the mock echoing them back.
    const select = draftFindMany.mock.calls[0][0].select.contact.select;
    expect(select.phone).toBe(true);
    expect(select.channels).toBe(true);
  });

  it("quiet people carry a Hebrew reason in priority order", async () => {
    profileFindMany.mockResolvedValue([
      { contact: { id: "q1", fullName: "Ofir Alon", currentCompany: "Delek" } },
      { contact: { id: "q2", fullName: "Ami Serkis", currentCompany: "365Scores" } },
      { contact: { id: "q3", fullName: "Asaf Bar-Or", currentCompany: "Triolla" } },
    ]);
    draftGroupBy.mockResolvedValue([{ contactId: "q1", _count: { _all: 4 } }]);
    sentGroupBy.mockResolvedValue([{ contactId: "q3", _max: { sentAt: new Date(Date.now() - 5 * 864e5) } }]);
    const res = await GET(req);
    const body = await (res as Response).json();
    const byId = Object.fromEntries(body.quiet.map((q: { contactId: string; reason: string }) => [q.contactId, q.reason]));
    expect(byId.q1).toBe("4 מועמדות נפסלו בשער האישי");
    expect(byId.q2).toBe("אין חומר בתחומים שלו השבוע");
    expect(byId.q3).toContain("בהמתנה");
  });

  it("a person with a pending draft is not in the quiet list", async () => {
    profileFindMany.mockResolvedValue([{ contact: { id: "ct1", fullName: "Avigal Soreq", currentCompany: "Delek US" } }]);
    draftFindMany.mockResolvedValue([pendingDraft()]);
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.quiet).toEqual([]);
  });

  it("scan is null when no finished run exists — an explained empty state, not zeros", async () => {
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.scan).toBeNull();
    expect(body.firstName).toBe("יובל");
  });

  // Pre-gate rows can still have no publishedAt. The screen must say so, not borrow
  // the row's insert time and pass it off as the article's publication date.
  it("sourcePublishedAt is null, never the row's createdAt, when the item has no publishedAt", async () => {
    draftFindMany.mockResolvedValue([
      pendingDraft({ item: { title: "EPA finalizes RVOs", summary: "EPA set targets", sources: [{ url: CANON, title: "EPA finalizes" }], publishedAt: null, createdAt: new Date("2026-08-23T10:00:00Z") } }),
    ]);
    const res = await GET(req);
    const body = await (res as Response).json();
    expect(body.drafts[0].sourcePublishedAt).toBeNull();
  });
});
