import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class RateLimitError extends Error {
  constructor() {
    super("LinkedIn rate limit detected");
    this.name = "RateLimitError";
  }
}

export type RawConnection = {
  urn: string;
  profileUrl: string;
  fullName: string;
  headline?: string;
  connectedAt?: string;
};

export type RawProfile = {
  urn: string;
  fullName: string;
  headline?: string;
  currentTitle?: string;
  currentCompany?: string;
  currentCompanyId?: string;
  companySize?: number;
  location?: string;
  profilePicUrl?: string;
};

type MockData = {
  connections?: RawConnection[];
  profiles?: Record<string, RawProfile>;
};

const RATE_LIMIT_SIGNATURES = [
  "rate limit",
  "too many requests",
  "429",
  "restricted",
  "challenge",
];

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_SIGNATURES.some((s) => lower.includes(s));
}

/** Randomized delay between LinkedIn MCP calls (30–90 seconds). */
function jitteredDelay(): Promise<void> {
  const ms = 30_000 + Math.random() * 60_000;
  return new Promise((r) => setTimeout(r, ms));
}

export class LinkedinMcp {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private mockData: MockData | null = null;
  private lastCallAt = 0;
  private readonly IDLE_TIMEOUT = 2 * 60 * 1000;
  private readonly MAX_LIFETIME = 30 * 60 * 1000;
  private openedAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  /** Opens a real MCP subprocess with the given LinkedIn cookie. */
  static async open(cookie: string): Promise<LinkedinMcp> {
    const instance = new LinkedinMcp();
    instance.openedAt = Date.now();

    const transport = new StdioClientTransport({
      command: "uvx",
      args: ["linkedin-mcp-server"],
      env: { ...process.env, LINKEDIN_LI_AT: cookie },
    });

    const client = new Client({ name: "linkedin-si-worker", version: "1.0.0" });
    await client.connect(transport);

    instance.client = client;
    instance.transport = transport;
    instance.resetIdleTimer();

    return instance;
  }

  /** Returns a fully in-memory fake suitable for unit tests. */
  static openMock(data: MockData): LinkedinMcp {
    const instance = new LinkedinMcp();
    instance.mockData = data;
    instance.openedAt = Date.now();
    return instance;
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), this.IDLE_TIMEOUT);
  }

  private async beforeCall() {
    if (Date.now() - this.openedAt > this.MAX_LIFETIME) {
      await this.close();
      throw new Error("MCP process exceeded maximum lifetime; reconnect required");
    }
    // Enforce jitter between calls (only in real mode, not mock)
    if (!this.mockData && this.lastCallAt > 0) {
      await jitteredDelay();
    }
    this.lastCallAt = Date.now();
    this.resetIdleTimer();
  }

  async getConnections(opts?: {
    cursor?: string;
  }): Promise<{ items: RawConnection[]; nextCursor: string | null }> {
    await this.beforeCall();

    if (this.mockData) {
      const all = this.mockData.connections ?? [];
      const pageSize = 50;
      const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
      const items = all.slice(offset, offset + pageSize);
      const nextCursor = offset + pageSize < all.length ? String(offset + pageSize) : null;
      return { items, nextCursor };
    }

    const result = await this.client!.callTool({
      name: "get_connections",
      arguments: opts?.cursor ? { cursor: opts.cursor } : {},
    });
    const content = result.content as { type: string; text: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text);
    if (parsed.error && isRateLimitError(String(parsed.error))) throw new RateLimitError();
    return { items: parsed.connections ?? [], nextCursor: parsed.nextCursor ?? null };
  }

  async getProfile(urn: string): Promise<RawProfile> {
    await this.beforeCall();

    if (this.mockData) {
      const profile = this.mockData.profiles?.[urn];
      if (!profile) return { urn, fullName: "Unknown" };
      return profile;
    }

    const result = await this.client!.callTool({
      name: "get_profile",
      arguments: { urn },
    });
    const content = result.content as { type: string; text: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text);
    if (parsed.error && isRateLimitError(String(parsed.error))) throw new RateLimitError();
    return parsed as RawProfile;
  }

  async sendMessage(urn: string, body: string): Promise<{ messageId: string }> {
    await this.beforeCall();

    if (this.mockData) {
      return { messageId: `mock-msg-${Date.now()}` };
    }

    const result = await this.client!.callTool({
      name: "send_message",
      arguments: { urn, message: body },
    });
    const content = result.content as { type: string; text: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text);
    if (parsed.error && isRateLimitError(String(parsed.error))) throw new RateLimitError();
    return { messageId: parsed.messageId ?? parsed.id ?? String(Date.now()) };
  }

  /** Cheap validation call — checks if cookie is still alive. */
  async validateCookie(): Promise<boolean> {
    if (this.mockData) return true;

    try {
      await this.beforeCall();
      await this.client!.callTool({ name: "validate_session", arguments: {} });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // ignore
      }
      this.transport = null;
      this.client = null;
    }
  }
}
