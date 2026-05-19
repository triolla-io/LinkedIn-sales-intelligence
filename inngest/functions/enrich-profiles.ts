import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/linkedin/sse-bus";
import { spawn } from "child_process";
import * as path from "path";

const UVX = process.env.UVX_PATH ?? "uvx";
const SCRAPER = path.join(process.cwd(), "lib/linkedin/profile_scraper.py");
const BATCH_SIZE = 100;

async function runProfileScraper(
  contacts: { id: string; profileUrl: string }[],
  onProgress?: (done: number) => void,
): Promise<
  { id: string; location?: string; industry?: string; employees?: number; error?: string }[]
> {
  return new Promise((resolve, reject) => {
    const proc = spawn(UVX, ["--from", "patchright", "python", SCRAPER], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
    });

    let stdout = "";
    let progressCount = 0;
    let lineBuf = "";
    proc.stdout.on("data", (b) => {
      const chunk = b.toString();
      stdout += chunk;
      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.progress) {
            progressCount++;
            onProgress?.(progressCount);
          }
        } catch {}
      }
    });
    proc.stderr.on("data", () => {}); // suppress patchright noise

    proc.stdin.write(JSON.stringify(contacts));
    proc.stdin.end();

    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Scraper exited ${code}`));
      const lastLine = stdout.trim().split("\n").pop() ?? "{}";
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed.results ?? []);
      } catch {
        reject(new Error(`Invalid JSON: ${stdout.slice(0, 300)}`));
      }
    });
    proc.on("error", reject);
  });
}

export const enrichProfiles = inngest.createFunction(
  {
    id: "enrich-profiles",
    concurrency: { limit: 1 },
    triggers: [{ event: "profiles.enrich" as const }],
  },
  async ({ event, step }: any) => {
    const { userId } = event.data as { userId: string };

    const contacts = await step.run("load-contacts", () =>
      prisma.contact.findMany({
        where: {
          ownerId: userId,
          OR: [{ location: null }, { industry: null }, { companySize: null }],
        },
        select: { id: true, linkedinUrl: true },
        take: BATCH_SIZE,
      })
    );

    if (!contacts.length) {
      publish(userId, { type: "linkedin:enrich-done", data: { updated: 0 } });
      return { skipped: true, reason: "all contacts already enriched" };
    }

    const input = contacts
      .filter((c: any) => c.linkedinUrl)
      .map((c: any) => ({ id: c.id, profileUrl: c.linkedinUrl }));

    const total = input.length;
    const results = await step.run("scrape-profiles", () =>
      runProfileScraper(input, (done) => {
        publish(userId, { type: "linkedin:enrich-progress", data: { done, total } });
      }),
    );

    const updated = await step.run("save-enrichments", async () => {
      let count = 0;
      for (const r of results) {
        if (r.error) continue;
        await prisma.contact.update({
          where: { id: r.id },
          data: {
            ...(r.location ? { location: r.location } : {}),
            ...(r.industry ? { industry: r.industry } : {}),
            ...(r.employees ? { companySize: r.employees } : {}),
          },
        });
        count++;
      }
      return count;
    });

    if (contacts.length === BATCH_SIZE) {
      await step.sendEvent("chain-next-batch", {
        name: "profiles.enrich" as const,
        data: { userId },
      });
    } else {
      publish(userId, { type: "linkedin:enrich-done", data: { updated } });
    }

    return { success: true, total: contacts.length, updated };
  }
);
