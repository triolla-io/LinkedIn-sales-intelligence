import { spawn } from "node:child_process";
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";

type VoyagerCompany = {
  universalName: string;
  name: string;
  industry: string | null;
  industries: string[];
  staffCount: number | null;
  website: string | null;
  description: string | null;
};

function runScraper(slugs: string[]): Promise<VoyagerCompany[]> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const uvxPath = process.env.UVX_PATH ?? "uvx";
    const child = spawn(
      uvxPath,
      ["--from", "patchright", "--with", "aiohttp", "python", "lib/linkedin/voyager_companies.py"],
      { cwd, env: { ...process.env, PYTHONPATH: cwd } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code: number | null) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`voyager_companies.py exit ${code}: ${stderr.slice(0, 500)}`));
      }
      const lastLine = stdout.trim().split("\n").pop() ?? "{}";
      try {
        const parsed = JSON.parse(lastLine) as { companies: VoyagerCompany[]; error: string | null };
        if (parsed.error?.startsWith("SESSION_EXPIRED")) {
          return reject(new Error(parsed.error));
        }
        resolve(parsed.companies ?? []);
      } catch (e) {
        reject(new Error(`Failed to parse scraper output: ${lastLine.slice(0, 200)}`));
      }
    });
    child.stdin.write(JSON.stringify(slugs));
    child.stdin.end();
  });
}

export const enrichCompanies = inngest.createFunction(
  {
    id: "enrich-companies",
    name: "Enrich companies from Voyager",
    concurrency: { limit: 1 },
    retries: 2,
    triggers: [{ event: "companies.enrich" as const }],
  },
  async ({ event, step }: any) => {
    const requestedSlugs: string[] = event.data.slugs ?? [];

    const toEnrich = await step.run("find-companies-needing-enrichment", async () => {
      const rows = await prisma.company.findMany({
        where: {
          universalName: { in: requestedSlugs },
          staffCount: null,
        },
        select: { universalName: true },
      });
      return rows.map((r: { universalName: string }) => r.universalName);
    });

    if (toEnrich.length === 0) return { enriched: 0, skipped: requestedSlugs.length };

    const fetched = await step.run("fetch-from-voyager", () => runScraper(toEnrich));

    const enriched = await step.run("upsert-companies", async () => {
      let count = 0;
      for (const c of fetched) {
        await prisma.company.update({
          where: { universalName: c.universalName },
          data: {
            name: c.name || undefined,
            industry: c.industry,
            staffCount: c.staffCount,
            website: c.website,
            description: c.description,
            lastEnrichedAt: new Date(),
          },
        });
        count++;
      }
      return count;
    });

    return { enriched, requested: requestedSlugs.length };
  },
);
