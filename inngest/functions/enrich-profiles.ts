import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { spawn } from "child_process";
import * as path from "path";

const UVX = process.env.UVX_PATH ?? "uvx";
const SCRAPER = path.join(process.cwd(), "lib/linkedin/profile_scraper.py");

async function runProfileScraper(contacts: { id: string; profileUrl: string }[]): Promise<
  { id: string; location?: string; industry?: string; employees?: number; error?: string }[]
> {
  return new Promise((resolve, reject) => {
    const proc = spawn(UVX, ["--from", "patchright", "python", SCRAPER], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
    });

    let stdout = "";
    proc.stdout.on("data", (b) => {
      stdout += b.toString();
      // Stream progress lines to console
      const lines = b.toString().trim().split("\n");
      for (const line of lines) {
        if (line.includes("progress") || line.includes("company")) {
          try { console.log("[profile-enrich]", JSON.parse(line)); } catch {}
        }
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
          OR: [{ location: null }, { industry: null }],
        },
        select: { id: true, linkedinUrl: true },
        take: 100,
      })
    );

    if (!contacts.length) return { skipped: true, reason: "all contacts already enriched" };

    const input = contacts
      .filter((c: any) => c.linkedinUrl)
      .map((c: any) => ({ id: c.id, profileUrl: c.linkedinUrl }));

    const results = await step.run("scrape-profiles", () => runProfileScraper(input));

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

    return { success: true, total: contacts.length, updated };
  }
);
