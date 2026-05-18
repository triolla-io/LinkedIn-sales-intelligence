import { describe, it, expect } from "vitest";
import { LinkedinMcp, RateLimitError } from "@/lib/linkedin/mcp-client";
import type { RawConnection, RawProfile } from "@/lib/linkedin/mcp-client";

function makeConnections(n: number): RawConnection[] {
  return Array.from({ length: n }, (_, i) => ({
    urn: `urn:li:person:${i}`,
    profileUrl: `https://linkedin.com/in/user${i}`,
    fullName: `User ${i}`,
    headline: `Engineer ${i}`,
    connectedAt: new Date().toISOString(),
  }));
}

describe("LinkedinMcp mock", () => {
  it("paginates connections in pages of 50", async () => {
    const mcp = LinkedinMcp.openMock({ connections: makeConnections(120) });

    const p1 = await mcp.getConnections();
    expect(p1.items).toHaveLength(50);
    expect(p1.nextCursor).toBe("50");

    const p2 = await mcp.getConnections({ cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(50);
    expect(p2.nextCursor).toBe("100");

    const p3 = await mcp.getConnections({ cursor: p2.nextCursor! });
    expect(p3.items).toHaveLength(20);
    expect(p3.nextCursor).toBeNull();
  });

  it("returns profile from mock data", async () => {
    const profiles: Record<string, RawProfile> = {
      "urn:li:person:1": { urn: "urn:li:person:1", fullName: "Alice", currentTitle: "CTO" },
    };
    const mcp = LinkedinMcp.openMock({ profiles });
    const profile = await mcp.getProfile("urn:li:person:1");
    expect(profile.fullName).toBe("Alice");
    expect(profile.currentTitle).toBe("CTO");
  });

  it("returns fallback profile for unknown urn", async () => {
    const mcp = LinkedinMcp.openMock({});
    const profile = await mcp.getProfile("urn:li:person:unknown");
    expect(profile.fullName).toBe("Unknown");
  });

  it("returns a mock messageId from sendMessage", async () => {
    const mcp = LinkedinMcp.openMock({});
    const result = await mcp.sendMessage("urn:li:person:1", "Hello!");
    expect(result.messageId).toMatch(/^mock-msg-/);
  });

  it("validateCookie returns true in mock mode", async () => {
    const mcp = LinkedinMcp.openMock({});
    expect(await mcp.validateCookie()).toBe(true);
  });

  it("close resolves without throwing in mock mode", async () => {
    const mcp = LinkedinMcp.openMock({});
    await expect(mcp.close()).resolves.toBeUndefined();
  });
});
