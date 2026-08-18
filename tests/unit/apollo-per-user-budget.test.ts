import { describe, it, expect, vi, beforeEach } from "vitest";

const orgSpendFindUnique = vi.hoisted(() => vi.fn());
const userSpendFindUnique = vi.hoisted(() => vi.fn());
const orgSpendUpsert = vi.hoisted(() => vi.fn());
const userSpendUpsert = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn(async (ops: unknown[]) => ops));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enrichmentSpend: { findUnique: orgSpendFindUnique, upsert: orgSpendUpsert },
    userEnrichmentSpend: { findUnique: userSpendFindUnique, upsert: userSpendUpsert },
    $transaction: transaction,
  },
}));

beforeEach(() => vi.clearAllMocks());

const base = { orgId: "o1", userId: "u1", orgLimit: 2000, userLimit: 1000 };

/** org pool used / per-user used */
function spend(org: number | null, user: number | null) {
  orgSpendFindUnique.mockResolvedValue(org === null ? null : { credits: org });
  userSpendFindUnique.mockResolvedValue(user === null ? null : { credits: user });
}

describe("checkEnrichmentBudget — org pool AND per-user quota", () => {
  it("allows a fresh user in a fresh org, headroom = the tighter limit", async () => {
    spend(null, null);
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.allowed).toBe(true);
    expect(r.blockedBy).toBe(null);
    expect(r.orgRemaining).toBe(2000);
    expect(r.userRemaining).toBe(1000);
    // The user quota is the binding constraint, so that is the headroom shown.
    expect(r.creditsRemaining).toBe(1000);
  });

  it("blocks the user at their own quota even when the org pool has room", async () => {
    spend(1000, 1000); // org has 1000 left, this user has spent all 1000 of theirs
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("user");
    expect(r.orgRemaining).toBe(1000);
    expect(r.userRemaining).toBe(0);
    expect(r.creditsRemaining).toBe(0);
  });

  it("blocks when the org pool is drained even though this user has quota left", async () => {
    spend(2000, 50); // pool gone (other users spent it), this user only used 50
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("org");
    expect(r.userRemaining).toBe(950);
    expect(r.creditsRemaining).toBe(0);
  });

  it("reports the org as the blocker when both are exhausted", async () => {
    spend(2000, 1000);
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("org");
  });

  it("clamps the org pool headroom below the user quota when the pool is nearly gone", async () => {
    spend(1995, 10); // only 5 left in the pool; user still has 990 of their own
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.allowed).toBe(true);
    expect(r.creditsRemaining).toBe(5);
  });

  it("never reports negative headroom when spend overshot a limit", async () => {
    spend(2100, 1200);
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(r.orgRemaining).toBe(0);
    expect(r.userRemaining).toBe(0);
    expect(r.creditsRemaining).toBe(0);
  });

  it("blocks on a zero per-user quota", async () => {
    spend(null, null);
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget({ ...base, userLimit: 0 });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("user");
  });

  it("scopes the per-user lookup to that user and month", async () => {
    spend(0, 0);
    const { checkEnrichmentBudget } = await import("@/lib/apollo/budget");
    const r = await checkEnrichmentBudget(base);
    expect(userSpendFindUnique.mock.calls[0][0].where.userId_month).toEqual({
      userId: "u1",
      month: r.month,
    });
  });
});

describe("incrementBudget — charges both counters atomically", () => {
  it("increments the org pool and the user row in one transaction", async () => {
    const { incrementBudget } = await import("@/lib/apollo/budget");
    await incrementBudget({ orgId: "o1", userId: "u1", credits: 9 });

    // Both upserts must be handed to $transaction, not awaited separately, or a
    // crash between them silently un-charges one of the two counters.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(orgSpendUpsert).toHaveBeenCalledTimes(1);
    expect(userSpendUpsert).toHaveBeenCalledTimes(1);

    expect(orgSpendUpsert.mock.calls[0][0].update).toEqual({ credits: { increment: 9 } });
    expect(userSpendUpsert.mock.calls[0][0].update).toEqual({ credits: { increment: 9 } });
  });

  it("stamps orgId on the user row so admin can roll up per-org spend", async () => {
    const { incrementBudget } = await import("@/lib/apollo/budget");
    await incrementBudget({ orgId: "o1", userId: "u1", credits: 1 });
    expect(userSpendUpsert.mock.calls[0][0].create).toMatchObject({
      userId: "u1",
      orgId: "o1",
      credits: 1,
    });
  });
});
