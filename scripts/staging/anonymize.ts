// scripts/staging/anonymize.ts
import { prisma } from "@/lib/prisma";
import { anonymizePhone, parsePool, assertStagingDatabase } from "./anonymize.lib";

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assertStagingDatabase(databaseUrl, process.env.STAGING_ANONYMIZE_CONFIRM);

  const testPhone = anonymizePhone(process.env.STAGING_TEST_PHONE ?? "");
  const pool = parsePool(process.env.STAGING_TEST_LINKEDIN_URLS);

  try {
    // 1. Contact emails -> ariel+<id>@triolla.io (deterministic per row).
    await prisma.$executeRawUnsafe(
      `UPDATE "Contact" SET "email" = 'ariel+' || "id" || '@triolla.io' WHERE "email" IS NOT NULL`
    );

    // 2. Contact phones -> single test number.
    await prisma.$executeRawUnsafe(
      `UPDATE "Contact" SET "phone" = $1 WHERE "phone" IS NOT NULL`,
      testPhone
    );

    // 3. Contact LinkedIn URLs -> cycle through the controlled test-profile pool.
    //    Map each row to pool[rownum % poolLen] using a window function.
    const valuesSql = pool.map((_, i) => `(${i}, $${i + 1}::text)`).join(",");
    await prisma.$executeRawUnsafe(`
      WITH numbered AS (
        SELECT "id", (ROW_NUMBER() OVER (ORDER BY "id") - 1) % ${pool.length} AS slot
        FROM "Contact"
      ),
      poolmap("slot","url") AS ( VALUES ${valuesSql} )
      UPDATE "Contact" c
      SET "linkedinUrl" = p."url"
      FROM numbered n JOIN poolmap p ON p."slot" = n."slot"
      WHERE c."id" = n."id"
    `, ...pool);

    // 4. Clear OAuth tokens so staging never sends as prod-connected Google accounts.
    //    (Users re-connect their own Google in staging.)
    await prisma.$executeRawUnsafe(
      `UPDATE "Account" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL`
    );

    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "Contact"`
    );
    console.log(`✅ anonymized ${count} contacts → routed to ariel+*@triolla.io / ${testPhone} / ${pool.length} LinkedIn profiles`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌ anonymize failed:", e);
  process.exit(1);
});
