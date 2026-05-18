import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
const mockTransaction = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mockFindUnique, create: mockCreate },
    $transaction: mockTransaction,
  },
}));

describe("signIn callback — first-time user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(null); // user doesn't exist yet
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        organization: { create: vi.fn().mockResolvedValue({ id: "org1" }) },
        user: { create: vi.fn().mockResolvedValue({ id: "user1" }) },
      };
      await fn(tx);
      return tx;
    });
  });

  it("creates org + user in a transaction on first sign-in", async () => {
    // Dynamically import so the mock is in place
    const { signInCallback } = await import("./helpers/auth-callbacks");
    const result = await signInCallback({ email: "test@example.com", name: "Test User" });
    expect(result).toBe(true);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("returns false when user has no email", async () => {
    const { signInCallback } = await import("./helpers/auth-callbacks");
    const result = await signInCallback({ email: undefined, name: "Test" });
    expect(result).toBe(false);
  });
});

describe("signIn callback — returning user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ id: "user1", orgId: "org1", role: "SALESPERSON" });
  });

  it("does not create a duplicate org on second sign-in", async () => {
    const { signInCallback } = await import("./helpers/auth-callbacks");
    const result = await signInCallback({ email: "test@example.com", name: "Test User" });
    expect(result).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
