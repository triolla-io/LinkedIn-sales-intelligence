/**
 * The WRITING rebuild. Runs only after a preview was read and approved by a human.
 *
 * Two conditions, both enforced here rather than trusted to a checklist:
 *   1. --backup=<path> must point at a snapshot from scripts/radar-backup-model.ts. The
 *      rebuild deletes un-muted PersonAxis rows, and one of them is the axis that
 *      produced the first message the system ever sent.
 *   2. It prints a per-person BEFORE / AFTER comparison, not just the new model. "Here
 *      are the new axes" hides the thing you actually need to see: what was lost.
 *
 * Order: employers are re-researched first — they feed everything, and building a person
 * model on the old research reproduces the very deficiency being fixed.
 *
 *   node_modules/.bin/tsx scripts/radar-backup-model.ts --owner=<id> --out=/tmp/snap.json
 *   node_modules/.bin/tsx scripts/radar-rebuild-people.ts --owner=<id> --backup=/tmp/snap.json
 *   ... --write     actually research and rebuild
 *
 * Spend (no Apollo): per employer one news sweep + one profile call; per person one brain
 * call + one gate call.
 */
import { prisma } from "@/lib/prisma";
import { researchTrackedCompany } from "@/lib/tech-radar/research-company";
import { buildProfilesForMarked } from "@/lib/tech-radar/build-profiles";
import { markedEmployers, upsertEmployers } from "@/lib/tech-radar/population";
import { runFixtures, type ProposedAxis } from "@/lib/tech-radar/rebuild-fixtures";
import { newsQuotaStatus } from "@/lib/news/budget";
import { existsSync, readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function rule(s: string) {
  console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);
}

type AxisRow = { label: string; rationale: string; queries: string[]; muted: boolean };

async function readModel(ownerId: string): Promise<Map<string, { name: string; slug: string; axes: AxisRow[] }>> {
  const profiles = await prisma.personProfile.findMany({
    where: { contact: { ownerId } },
    select: {
      contactId: true,
      contact: { select: { fullName: true, linkedinUrl: true } },
      axes: {
        select: {
          rationale: true, mutedAt: true,
          axis: { select: { label: true, searchQueries: true } },
        },
      },
    },
  });
  return new Map(
    profiles.map((p) => [
      p.contactId,
      {
        name: p.contact.fullName,
        slug: p.contact.linkedinUrl ?? "",
        axes: p.axes.map((a) => ({
          label: a.axis.label,
          rationale: a.rationale,
          queries: a.axis.searchQueries,
          muted: a.mutedAt != null,
        })),
      },
    ])
  );
}

async function main() {
  const ownerId = arg("owner");
  const backup = arg("backup");
  const write = process.argv.includes("--write");
  if (!ownerId) {
    console.error("Usage: --owner=<userId> --backup=<snapshot.json> [--write]");
    process.exit(1);
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { id: true, email: true, orgId: true },
  });
  if (!owner.orgId) throw new Error("owner has no org");

  // Condition 1, enforced: no snapshot, no destructive rebuild.
  if (write) {
    if (!backup) {
      console.error("\nREFUSING: --write requires --backup=<path> from scripts/radar-backup-model.ts.");
      console.error("The rebuild deletes un-muted PersonAxis rows, including the axis behind the sent message.\n");
      process.exit(1);
    }
    if (!existsSync(backup)) {
      console.error(`\nREFUSING: backup file not found at ${backup}\n`);
      process.exit(1);
    }
    const snap = JSON.parse(readFileSync(backup, "utf8")) as { owner?: { id?: string }; counts?: { unmutedPersonAxes?: number } };
    if (snap.owner?.id !== owner.id) {
      console.error(`\nREFUSING: snapshot belongs to owner ${snap.owner?.id}, not ${owner.id}\n`);
      process.exit(1);
    }
    console.log(`\nbackup verified: ${backup} (${snap.counts?.unmutedPersonAxes ?? "?"} un-muted axes captured)`);
  }

  console.log(`owner: ${owner.email}   org: ${owner.orgId}`);
  console.log(`mode:  ${write ? "WRITE — will re-research and rebuild" : "DRY RUN — nothing written"}`);

  const before = await readModel(owner.id);

  const employers = await markedEmployers(owner.id);
  const upsert = await upsertEmployers(owner.orgId, employers);
  const tracked = await prisma.trackedCompany.findMany({
    where: { orgId: owner.orgId },
    select: { id: true, name: true, status: true },
  });
  const norm = (s: string) => s.trim().toLowerCase();
  const toResearch = tracked.filter(
    (t) => employers.some((e) => norm(e.name) === norm(t.name)) || upsert.pendingResearch.includes(t.id)
  );

  rule(`EMPLOYERS TO RE-RESEARCH (${toResearch.length}) — they feed everything downstream`);
  for (const t of toResearch) console.log(`  ${t.name} [${t.status}]`);

  rule(`CURRENT MODEL (${before.size} people)`);
  for (const [, p] of before) {
    console.log(`\n  ${p.name}`);
    for (const a of p.axes) console.log(`    ${a.muted ? "(muted) " : ""}${a.label}`);
  }

  if (!write) {
    console.log(`\nDRY RUN. To proceed:`);
    console.log(`  1. node_modules/.bin/tsx scripts/radar-preview-brain.ts --owner=${owner.id}   (read it)`);
    console.log(`  2. node_modules/.bin/tsx scripts/radar-backup-model.ts --owner=${owner.id} --out=/tmp/snap.json`);
    console.log(`  3. re-run this with --backup=/tmp/snap.json --write\n`);
    return;
  }

  for (const t of toResearch) {
    const outcome = await researchTrackedCompany(t.id);
    console.log(`  researched ${t.name}: ${JSON.stringify(outcome)}`);
    if (outcome.status !== "ACTIVE") {
      console.error(`\nSTOPPING: ${t.name} is not ACTIVE, so every person there would be skipped.`);
      console.error(`Nothing has been rebuilt yet. Fix the company, then re-run.\n`);
      process.exit(1);
    }
  }

  const report = await buildProfilesForMarked({ orgId: owner.orgId, ownerId: owner.id, force: true });
  const after = await readModel(owner.id);

  // Condition 2, enforced: the comparison, not just the new state.
  rule("BEFORE / AFTER, PER PERSON");
  for (const [contactId, prev] of before) {
    const next = after.get(contactId);
    console.log(`\n${"─".repeat(78)}\n${prev.name}\n${"─".repeat(78)}`);

    const prevLabels = new Set(prev.axes.filter((a) => !a.muted).map((a) => a.label));
    const nextLabels = new Set((next?.axes ?? []).filter((a) => !a.muted).map((a) => a.label));

    for (const label of prevLabels) {
      if (!nextLabels.has(label)) console.log(`  − LOST   ${label}`);
    }
    for (const label of nextLabels) {
      if (!prevLabels.has(label)) console.log(`  + NEW    ${label}`);
      else console.log(`  = KEPT   ${label}`);
    }
    for (const a of prev.axes.filter((x) => x.muted)) console.log(`  · muted, preserved: ${a.label}`);

    const axes: ProposedAxis[] = (next?.axes ?? [])
      .filter((a) => !a.muted)
      .map((a) => ({ label: a.label, rationale: a.rationale, queries: a.queries }));
    const fx = runFixtures(next?.slug ?? prev.slug, axes);
    if (fx.checks.length) {
      console.log(`\n  SMOKE TEST — keyword checks, NOT proof the axes are right:`);
      for (const ch of fx.checks) console.log(`    ${ch.clean ? "○" : "●"} ${ch.verdict} — ${ch.describe}`);
    }
  }

  rule("REBUILD REPORT");
  console.log(JSON.stringify(report, null, 2));

  rule("NEWS QUOTA AFTER THE REBUILD");
  for (const p of ["serper", "serpapi", "gnews", "tavily"] as const) {
    const q = await newsQuotaStatus(p);
    console.log(`  ${p.padEnd(8)} window=${q.window} used=${q.used}${q.cap != null ? `/${q.cap}` : ""} remaining=${q.remaining ?? "unknown"}`);
  }
  console.log(`\nTo restore the previous model: the snapshot at ${backup}\n`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
