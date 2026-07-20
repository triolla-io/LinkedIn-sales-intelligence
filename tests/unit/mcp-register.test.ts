import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/queries", () => ({
  searchContacts: vi.fn(), getContact: vi.fn(), listProspectingRuns: vi.fn(),
  getRunStatus: vi.fn(), connectionStats: vi.fn(), listSequences: vi.fn(),
  getSequenceStatus: vi.fn(), listCampaigns: vi.fn(), getCampaignStatus: vi.fn(),
}));
vi.mock("@/lib/mcp/actions", () => ({
  MAX_BULK: 200,
  enrichContacts: vi.fn(), enrollInSequence: vi.fn(),
  prospectingPause: vi.fn(), prospectingResume: vi.fn(),
  sequencePause: vi.fn(), sequenceResume: vi.fn(),
  campaignStart: vi.fn(), campaignPause: vi.fn(),
}));

const ctx = { userId: "u1", orgId: "o1", email: "ariel@triolla.io" };
beforeEach(() => vi.clearAllMocks());

describe("buildMcpServer", () => {
  it("registers all 17 tools", async () => {
    const { buildMcpServer } = await import("@/lib/mcp/register");
    const server = buildMcpServer(ctx);
    // McpServer's public API has no listTools()/getRegisteredTools() method (confirmed by
    // reading node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts — registerTool()
    // returns only a single RegisteredTool handle, and there is no enumeration accessor).
    // The registry itself IS stored under `_registeredTools` — confirmed at runtime by
    // instantiating McpServer and inspecting Object.getOwnPropertyNames(server); the TS
    // `private` modifier is compile-time-only, so the property exists on the JS object.
    // @ts-expect-error — reach into the registry for the count in the test only.
    const names = Object.keys(server._registeredTools ?? {});
    expect(names.length).toBe(17);
    expect(names).toContain("search_contacts");
    expect(names).toContain("enrich_contacts");
    expect(names).toContain("campaign_pause");
  });

  it("caps bulk action inputSchemas at MAX_BULK", async () => {
    const { buildMcpServer } = await import("@/lib/mcp/register");
    const server = buildMcpServer(ctx);
    // The SDK normalizes the raw Zod shape passed to `inputSchema` into a full
    // object schema (confirmed at runtime: `registeredTool.inputSchema` exposes
    // `.parse`/`.safeParse`, not the original per-field shape) — so we validate
    // the cap by parsing full payloads through it, not by reaching into a field.
    // @ts-expect-error — internal registry, test-only introspection.
    const tools = server._registeredTools as Record<string, { inputSchema?: { parse: (v: unknown) => unknown } }>;
    const overCap = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const underCap = ["c1", "c2"];

    expect(() => tools.enrich_contacts.inputSchema?.parse({ contactIds: overCap })).toThrow();
    expect(tools.enrich_contacts.inputSchema?.parse({ contactIds: underCap })).toEqual({ contactIds: underCap });

    expect(() =>
      tools.enroll_in_sequence.inputSchema?.parse({ sequenceId: "s1", contactIds: overCap })
    ).toThrow();
    expect(
      tools.enroll_in_sequence.inputSchema?.parse({ sequenceId: "s1", contactIds: underCap })
    ).toEqual({ sequenceId: "s1", contactIds: underCap });
  });
});
