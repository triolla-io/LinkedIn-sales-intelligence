import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as readline from "readline";

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

const RATE_LIMIT_SIGNATURES = ["rate limit", "too many requests", "429", "restricted", "challenge"];

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RATE_LIMIT_SIGNATURES.some((s) => lower.includes(s));
}

/** Small delay between LinkedIn API calls to avoid rate limiting. */
function jitteredDelay(): Promise<void> {
  const ms = 500 + Math.random() * 1_000;
  return new Promise((r) => setTimeout(r, ms));
}

const WORKER_SCRIPT = path.join(process.cwd(), "lib/linkedin/linkedin_worker.py");
const UVX_PATH = process.env.UVX_PATH ?? "uvx";

export class LinkedinMcp {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private seq = 0;
  private mockData: MockData | null = null;
  private lastCallAt = 0;
  private openedAt = 0;

  private constructor() {}

  static async open(_cookie: string): Promise<LinkedinMcp> {
    const instance = new LinkedinMcp();
    instance.openedAt = Date.now();

    const proc = spawn(UVX_PATH, ["--from", "linkedin-api", "python", WORKER_SCRIPT], {
      env: {
        ...process.env,
        LINKEDIN_USERNAME: process.env.LINKEDIN_USERNAME ?? "",
        LINKEDIN_PASSWORD: process.env.LINKEDIN_PASSWORD ?? "",
        LINKEDIN_COOKIES_DIR: "/tmp/linkedin_cookies/",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    instance.proc = proc;

    const rl = readline.createInterface({ input: proc.stdout! });
    instance.rl = rl;

    rl.on("line", (line) => {
      // responses come back in order — use a FIFO queue via Map iteration
      const first = instance.pending.entries().next().value;
      if (!first) return;
      const [id, { resolve, reject }] = first;
      instance.pending.delete(id);
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          if (isRateLimitError(String(parsed.error))) reject(new RateLimitError());
          else reject(new Error(String(parsed.error)));
        } else {
          resolve(parsed);
        }
      } catch {
        reject(new Error(`Invalid JSON from worker: ${line}`));
      }
    });

    proc.stderr!.on("data", (chunk) => {
      // suppress — linkedin-api prints debug noise to stderr
    });

    proc.on("exit", (code) => {
      for (const { reject } of instance.pending.values()) {
        reject(new Error(`Worker exited with code ${code}`));
      }
      instance.pending.clear();
    });

    return instance;
  }

  static openMock(data: MockData): LinkedinMcp {
    const instance = new LinkedinMcp();
    instance.mockData = data;
    instance.openedAt = Date.now();
    return instance;
  }

  private call(cmd: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      const line = JSON.stringify(cmd) + "\n";
      this.proc!.stdin!.write(line);
    });
  }

  private async beforeCall() {
    if (!this.mockData && this.lastCallAt > 0) {
      await jitteredDelay();
    }
    this.lastCallAt = Date.now();
  }

  async getConnections(opts?: { cursor?: string }): Promise<{ items: RawConnection[]; nextCursor: string | null }> {
    if (this.mockData) {
      const all = this.mockData.connections ?? [];
      const pageSize = 50;
      const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
      const items = all.slice(offset, offset + pageSize);
      const nextCursor = offset + pageSize < all.length ? String(offset + pageSize) : null;
      return { items, nextCursor };
    }

    const { spawn } = await import("child_process");
    const result: { connections: RawConnection[]; error: string | null } = await new Promise((resolve, reject) => {
      const proc = spawn(
        UVX_PATH,
        ["--from", "patchright", "--with", "beautifulsoup4", "python", "lib/linkedin/connections_scraper.py"],
        {
          cwd: process.cwd(),
          env: { ...process.env, PYTHONPATH: process.cwd() },
        }
      );
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (b) => { stdout += b.toString(); });
      proc.stderr.on("data", (b) => { stderr += b.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
        const lastLine = stdout.trim().split("\n").pop() ?? "{}";
        try {
          resolve(JSON.parse(lastLine));
        } catch {
          reject(new Error(`Scraper produced invalid JSON: ${stdout.slice(0, 500)}`));
        }
      });
      proc.on("error", reject);
    });

    if (result.error) {
      if (isRateLimitError(result.error)) throw new RateLimitError();
      throw new Error(result.error);
    }

    return { items: result.connections ?? [], nextCursor: null };
  }

  async getProfile(urn: string): Promise<RawProfile> {
    if (this.mockData) {
      return this.mockData.profiles?.[urn] ?? { urn, fullName: "Unknown" };
    }

    await this.beforeCall();
    return (await this.call({ cmd: "get_profile", urn })) as RawProfile;
  }

  async sendMessage(urn: string, body: string): Promise<{ messageId: string }> {
    if (this.mockData) {
      return { messageId: `mock-msg-${Date.now()}` };
    }

    await this.beforeCall();
    return (await this.call({ cmd: "send_message", urn, body })) as { messageId: string };
  }

  async validateCookie(): Promise<boolean> {
    if (this.mockData) return true;
    try {
      await this.beforeCall();
      const result = await this.call({ cmd: "validate" }) as { valid: boolean };
      return result.valid ?? false;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.stdin?.end();
      this.proc.kill();
      this.proc = null;
      this.rl = null;
    }
  }
}
