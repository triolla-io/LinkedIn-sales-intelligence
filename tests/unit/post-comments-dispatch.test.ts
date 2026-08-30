import { describe, it, expect, vi, beforeEach } from "vitest";

const mockContactFindMany = vi.fn();
const mockExtensionTaskFindMany = vi.fn();
const mockExtensionTaskCreateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: (...a: unknown[]) => mockContactFindMany(...a) },
    extensionTask: {
      findMany: (...a: unknown[]) => mockExtensionTaskFindMany(...a),
      createMany: (...a: unknown[]) => mockExtensionTaskCreateMany(...a),
    },
  },
}));

// --- A tiny in-memory stand-in for the Contact table --------------------------------------
// Rather than answering a fixed array (which can't distinguish a correct where-clause from a
// broken one), findMany actually evaluates the where clause dispatchPostScrapes builds, over
// a small fake table. That way "removedAt excludes a contact" and "org scoping excludes a
// contact" are proven by the outcome, not merely by inspecting call args.

type FakeContact = {
  id: string;
  ownerId: string;
  orgId: string;
  linkedinUrl: string;
  removedAt: Date | null;
  postWatchEnabled: boolean | null;
};
type OrgConfig = { id: string; postCommentsEnabled: boolean };

let contactsTable: FakeContact[] = [];
let orgs = new Map<string, OrgConfig>(); // ownerId -> org config

function orgFor(ownerId: string): OrgConfig {
  const org = orgs.get(ownerId);
  if (!org) throw new Error(`no org configured for owner ${ownerId}`);
  return org;
}

type ContactWhere = {
  postWatchEnabled?: boolean;
  linkedinUrl?: { not?: string };
  removedAt?: null;
  id?: { in?: string[] };
  owner?: { org?: { postCommentsEnabled?: boolean; id?: string } };
};

function matchesContactWhere(row: FakeContact, where: ContactWhere): boolean {
  if (where.postWatchEnabled !== undefined && row.postWatchEnabled !== where.postWatchEnabled) return false;
  if (where.linkedinUrl?.not !== undefined && row.linkedinUrl === where.linkedinUrl.not) return false;
  if ("removedAt" in where && where.removedAt === null && row.removedAt !== null) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  const org = orgFor(row.ownerId);
  if (where.owner?.org?.postCommentsEnabled !== undefined && org.postCommentsEnabled !== where.owner.org.postCommentsEnabled)
    return false;
  if (where.owner?.org?.id !== undefined && org.id !== where.owner.org.id) return false;
  return true;
}

function contact(overrides: Partial<FakeContact> & { id: string; ownerId: string }): FakeContact {
  return {
    linkedinUrl: `https://linkedin.com/in/${overrides.id}`,
    removedAt: null,
    postWatchEnabled: true,
    orgId: overrides.orgId ?? `org-of-${overrides.ownerId}`,
    ...overrides,
  };
}

/** The contact ids of the tasks the dispatch actually created. */
function createdContactIds(): string[] {
  if (mockExtensionTaskCreateMany.mock.calls.length === 0) return [];
  const data = mockExtensionTaskCreateMany.mock.calls[0][0].data as Array<{
    payload: { contactId: string };
  }>;
  return data.map((d) => d.payload.contactId);
}

beforeEach(() => {
  vi.clearAllMocks();
  contactsTable = [];
  orgs = new Map();
  mockExtensionTaskFindMany.mockResolvedValue([]); // no in-flight tasks by default
  mockExtensionTaskCreateMany.mockResolvedValue({ count: 0 });
  mockContactFindMany.mockImplementation(async (args: { where: ContactWhere }) =>
    contactsTable.filter((row) => matchesContactWhere(row, args.where))
  );
});

describe("dispatchPostScrapes", () => {
  it("excludes a removed contact and an empty-linkedinUrl contact, keeping only the eligible one", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    contactsTable = [
      contact({ id: "c-ok", ownerId: "o1" }),
      contact({ id: "c-removed", ownerId: "o1", removedAt: new Date() }),
      contact({ id: "c-no-url", ownerId: "o1", linkedinUrl: "" }),
    ];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes();

    expect(result.created).toBe(1);
    expect(createdContactIds()).toEqual(["c-ok"]);
  });

  it("does not create tasks for an org with postCommentsEnabled: false, even when the daily tick runs with no orgId", async () => {
    orgs.set("off-owner", { id: "org-off", postCommentsEnabled: false });
    contactsTable = [contact({ id: "c1", ownerId: "off-owner" })];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes();

    expect(result.created).toBe(0);
    expect(mockExtensionTaskCreateMany).not.toHaveBeenCalled();
  });

  it("the gate: an org with the module OFF gets zero tasks even when contactIds names its contacts explicitly", async () => {
    // This is the follow-route call shape: contactIds narrows to one contact, but the org
    // gate must still apply — a disabled org must not be reachable by naming contact ids.
    orgs.set("off-owner", { id: "org-off", postCommentsEnabled: false });
    contactsTable = [contact({ id: "c1", ownerId: "off-owner" })];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes({ contactIds: ["c1"] });

    expect(result.created).toBe(0);
    expect(mockExtensionTaskCreateMany).not.toHaveBeenCalled();
  });

  it("orgId scopes the dispatch to one org, leaving other enabled orgs untouched", async () => {
    orgs.set("owner-a", { id: "org-a", postCommentsEnabled: true });
    orgs.set("owner-b", { id: "org-b", postCommentsEnabled: true });
    contactsTable = [contact({ id: "a1", ownerId: "owner-a" }), contact({ id: "b1", ownerId: "owner-b" })];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes({ orgId: "org-a" });

    expect(result.created).toBe(1);
    expect(createdContactIds()).toEqual(["a1"]);
  });

  it("caps created tasks at MAX_SCRAPES_PER_OWNER_PER_RUN for a single owner", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    const { dispatchPostScrapes, MAX_SCRAPES_PER_OWNER_PER_RUN } = (await import(
      "@/lib/post-comments/dispatch"
    )) as typeof import("@/lib/post-comments/dispatch") & { MAX_SCRAPES_PER_OWNER_PER_RUN?: number };
    const cap = MAX_SCRAPES_PER_OWNER_PER_RUN ?? 25;

    contactsTable = Array.from({ length: cap + 5 }, (_, i) => contact({ id: `c${i}`, ownerId: "o1" }));

    const result = await dispatchPostScrapes();

    expect(result.created).toBe(cap);
    expect(createdContactIds()).toHaveLength(cap);
  });

  it("caps each owner independently — one owner's excess never reduces another owner's budget", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    orgs.set("o2", { id: "org2", postCommentsEnabled: true });
    contactsTable = [
      ...Array.from({ length: 30 }, (_, i) => contact({ id: `o1-c${i}`, ownerId: "o1" })),
      contact({ id: "o2-c0", ownerId: "o2" }),
    ];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes();

    expect(result.created).toBe(26); // 25 capped for o1 + 1 for o2
    expect(createdContactIds()).toContain("o2-c0");
  });

  it("skips a contact that already has a PENDING or CLAIMED SCRAPE_POSTS task, so a repeat dispatch doesn't double-queue it", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    contactsTable = [contact({ id: "c-queued", ownerId: "o1" }), contact({ id: "c-fresh", ownerId: "o1" })];
    mockExtensionTaskFindMany.mockResolvedValue([{ payload: { contactId: "c-queued" } }]);

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    const result = await dispatchPostScrapes();

    expect(mockExtensionTaskFindMany).toHaveBeenCalledWith({
      where: { kind: "SCRAPE_POSTS", status: { in: ["PENDING", "CLAIMED"] } },
      select: { payload: true },
    });
    expect(result.created).toBe(1);
    expect(createdContactIds()).toEqual(["c-fresh"]);
  });

  it("spreads created tasks' scheduledFor across the future rather than dumping them all at 'now'", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    contactsTable = Array.from({ length: 8 }, (_, i) => contact({ id: `c${i}`, ownerId: "o1" }));

    const before = Date.now();
    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    await dispatchPostScrapes();
    const after = Date.now();

    const data = mockExtensionTaskCreateMany.mock.calls[0][0].data as Array<{ scheduledFor: Date }>;
    const times = data.map((d) => d.scheduledFor.getTime());
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after + 6 * 60 * 60 * 1000 + 1000);
    }
    // Not every task fires at the same instant — the whole point of spreading them.
    expect(new Set(times).size).toBeGreaterThan(1);
  });

  it("builds the activity URL from the contact's linkedinUrl via buildActivityUrl", async () => {
    orgs.set("o1", { id: "org1", postCommentsEnabled: true });
    contactsTable = [contact({ id: "c1", ownerId: "o1", linkedinUrl: "https://www.linkedin.com/in/jane" })];

    const { dispatchPostScrapes } = await import("@/lib/post-comments/dispatch");
    await dispatchPostScrapes();

    const data = mockExtensionTaskCreateMany.mock.calls[0][0].data as Array<{
      payload: { activityUrl: string };
    }>;
    expect(data[0].payload.activityUrl).toBe("https://www.linkedin.com/in/jane/recent-activity/all/");
  });
});
