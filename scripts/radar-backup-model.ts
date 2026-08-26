/**
 * Snapshot the person model to JSON before anything destructive touches it.
 *
 * A force-rebuild deletes un-muted PersonAxis rows. One of the rows in the current prod
 * model is the axis that produced the first message the system ever sent — losing it
 * silently is not an option, so the rebuild refuses to run without one of these files.
 *
 * Read-only. Captures the employer profiles too: re-research overwrites them, and a
 * working profile is worth being able to restore.
 *
 * Also captures the layer-cake evidence chain: PersonProfile.domains (found/derived
 * fields of work) and PersonAxis.evidence (the layer 2/3/4 facts an axis was built
 * from). A rebuild regenerates both, so a restore that drops them silently loses the
 * receipts for why each axis existed, not just the axis label.
 *
 *   node_modules/.bin/tsx scripts/radar-backup-model.ts --owner=<userId> --out=<path>
 */
import { prisma } from "@/lib/prisma";
import { writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const ownerId = arg("owner");
  const out = arg("out");
  if (!ownerId || !out) {
    console.error("Usage: --owner=<userId> --out=<path.json>");
    process.exit(1);
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { id: true, email: true, orgId: true },
  });

  const profiles = await prisma.personProfile.findMany({
    where: { contact: { ownerId: owner.id } },
    select: {
      id: true, contactId: true, roleLens: true, reasoning: true, personalNotes: true,
      employerTrackedCompanyId: true, refreshedAt: true, domains: true,
      contact: { select: { fullName: true, linkedinUrl: true } },
      axes: {
        select: {
          id: true, axisId: true, weight: true, agenda: true, rationale: true,
          source: true, mutedAt: true, createdAt: true, evidence: true,
          axis: { select: { id: true, key: true, label: true, kind: true, searchQueries: true } },
        },
      },
    },
  });

  const trackedCompanies = owner.orgId
    ? await prisma.trackedCompany.findMany({
        where: { orgId: owner.orgId },
        select: {
          id: true, name: true, aliases: true, website: true, status: true,
          profile: true, profileError: true, researchedAt: true,
        },
      })
    : [];

  const drafts = await prisma.radarDraft.findMany({
    where: { ownerId: owner.id },
    select: { id: true, contactId: true, axisId: true, status: true, sentAt: true, draftMessage: true },
  });

  const snapshot = {
    takenAt: new Date().toISOString(),
    owner: { id: owner.id, email: owner.email, orgId: owner.orgId },
    counts: {
      personProfiles: profiles.length,
      personAxes: profiles.reduce((n, p) => n + p.axes.length, 0),
      unmutedPersonAxes: profiles.reduce((n, p) => n + p.axes.filter((a) => a.mutedAt == null).length, 0),
      trackedCompanies: trackedCompanies.length,
      drafts: drafts.length,
    },
    profiles,
    trackedCompanies,
    drafts,
  };

  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot -> ${out}`);
  console.log(JSON.stringify(snapshot.counts, null, 2));

  // The axes that produced a SENT draft, named explicitly: these are the rows whose loss
  // would actually cost something.
  const sentAxisIds = new Set(drafts.filter((d) => d.status === "SENT").map((d) => d.axisId));
  const load = profiles.flatMap((p) =>
    p.axes.filter((a) => sentAxisIds.has(a.axisId)).map((a) => `${p.contact.fullName} :: ${a.axis.label}`)
  );
  console.log(`\nAxes behind a SENT message (${load.length}) — the ones worth restoring:`);
  for (const l of load) console.log(`  ${l}`);
  console.log("");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
