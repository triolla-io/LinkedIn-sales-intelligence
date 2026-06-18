import { prisma } from "@/lib/prisma";
import { toIsraeliE164 } from "@/lib/phone/normalize";

/**
 * Backfill: re-normalize existing phone numbers to canonical Israeli E.164.
 * Fixes the legacy "+1…" mis-prefix and the invalid "+9720…" (extra trunk 0)
 * artifacts on Contact.phone and PersonEnrichment.phone.
 *
 * Only rows whose normalized value DIFFERS and resolves to a valid number are
 * touched — rows we can't parse are left untouched (no data loss).
 *
 * Dry-run by default; pass --apply to write.
 *   tsx scripts/backfill-phone-e164.ts           # preview
 *   tsx scripts/backfill-phone-e164.ts --apply   # update
 */
const APPLY = process.argv.includes("--apply");
const PAGE = 1000;

type Row = { id: string; phone: string | null };

async function backfill(
  label: string,
  fetchPage: (cursor: string | null) => Promise<Row[]>,
  update: (id: string, phone: string) => Promise<unknown>,
) {
  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;
  const samples: string[] = [];

  for (;;) {
    const rows = await fetchPage(cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      scanned++;
      if (!r.phone) continue;
      const normalized = toIsraeliE164(r.phone);
      if (normalized && normalized !== r.phone) {
        changed++;
        if (samples.length < 15) samples.push(`${r.phone} -> ${normalized}`);
        if (APPLY) await update(r.id, normalized);
      }
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }

  console.log(`\n${label}: scanned=${scanned} changed=${changed}`);
  for (const s of samples) console.log(`  ${s}`);
  if (changed > samples.length) console.log(`  …and ${changed - samples.length} more`);
  return changed;
}

async function main() {
  const contactChanged = await backfill(
    "Contact.phone",
    (cursor) =>
      prisma.contact.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true },
        orderBy: { id: "asc" },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (id, phone) => prisma.contact.update({ where: { id }, data: { phone } }),
  );

  const enrichmentChanged = await backfill(
    "PersonEnrichment.phone",
    (cursor) =>
      prisma.personEnrichment.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true },
        orderBy: { id: "asc" },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    (id, phone) => prisma.personEnrichment.update({ where: { id }, data: { phone } }),
  );

  console.log(
    `\n${APPLY ? "✓ Updated" : "Would update"} ${contactChanged + enrichmentChanged} rows ` +
      `(Contact ${contactChanged}, PersonEnrichment ${enrichmentChanged}).`,
  );
  if (!APPLY) console.log("Dry run — re-run with --apply to write these changes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
