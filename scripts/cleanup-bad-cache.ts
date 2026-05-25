import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BAD_EMAIL = "sharon@webiscope.com";
const BAD_PHONE = "+972504060064";

async function main() {
  const client = await pool.connect();
  try {
    // 1. Delete PersonEnrichment records with empty linkedinUrlNormalized
    const del = await client.query(
      `DELETE FROM "PersonEnrichment" WHERE "linkedinUrlNormalized" = '' RETURNING id`
    );
    console.log(`Deleted ${del.rowCount} bad PersonEnrichment records (empty URL key)`);

    // 2. Preview poisoned contacts
    const preview = await client.query(
      `SELECT id, "fullName", email, phone FROM "Contact"
       WHERE "enrichmentSource" = 'cache'
         AND (email = $1 OR phone = $2)`,
      [BAD_EMAIL, BAD_PHONE]
    );
    console.log(`Found ${preview.rowCount} poisoned contacts:`);
    for (const row of preview.rows) {
      console.log(`  - ${row.fullName} | email: ${row.email} | phone: ${row.phone}`);
    }

    if (preview.rowCount === 0) {
      console.log("Nothing to clean up.");
      return;
    }

    // 3. Clear bad email/phone from poisoned contacts
    const cleared = await client.query(
      `UPDATE "Contact"
       SET email = NULL,
           phone = NULL,
           "enrichmentSource" = NULL,
           "enrichmentRanAt" = NULL,
           "enrichedAt" = NULL
       WHERE "enrichmentSource" = 'cache'
         AND (email = $1 OR phone = $2)`,
      [BAD_EMAIL, BAD_PHONE]
    );
    console.log(`Cleared bad data from ${cleared.rowCount} contacts.`);
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
