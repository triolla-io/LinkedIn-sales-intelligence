/**
 * Seed Company rows from unique_companies.csv.
 * Usage: npx tsx prisma/seed-companies.ts [path/to/unique_companies.csv]
 * Default path: ~/Downloads/unique_companies.csv
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma";
import { slugifyCompany } from "../lib/utils/slug-utils";
import { getIndustry } from "../lib/classifier/industry";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function parseCsv(text: string): Array<Record<string, string>> {
  // Strip UTF-8 BOM if present
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

async function main() {
  const csvPath =
    process.argv[2] ?? path.join(os.homedir(), "Downloads", "unique_companies.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  console.log(`Parsed ${rows.length} rows from ${csvPath}`);

  let upserted = 0;
  let skipped = 0;
  const CHUNK = 100;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const entries: Array<{ slug: string; name: string; staffCount: number | null; industry: string | null }> = [];

    for (const row of chunk) {
      const name = row["Company"]?.trim();
      if (!name) { skipped++; continue; }

      const slug = slugifyCompany(name);
      if (!slug) { skipped++; continue; }

      const sizeRaw = row["Company_Size"]?.trim();
      const staffCount = sizeRaw ? (parseInt(sizeRaw, 10) || null) : null;
      const industry = getIndustry(name) || null;

      entries.push({ slug, name, staffCount, industry });
    }

    await prisma.$transaction(
      entries.map(({ slug, name, staffCount, industry }) =>
        prisma.company.upsert({
          where: { universalName: slug },
          update: {
            ...(staffCount != null ? { staffCount } : {}),
            ...(industry ? { industry } : {}),
          },
          create: {
            universalName: slug,
            name,
            ...(staffCount != null ? { staffCount } : {}),
            ...(industry ? { industry } : {}),
          },
        }),
      ),
    );

    upserted += entries.length;
    if (i % 1000 === 0) process.stdout.write(`  ${upserted}/${rows.length}...\r`);
  }

  console.log(`\nDone. Upserted: ${upserted}, skipped: ${skipped}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
