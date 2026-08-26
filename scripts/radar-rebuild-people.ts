/**
 * Rebuild the person model after a brain upgrade: re-research the marked cohort's
 * employers (the research now carries whatTheySell / customerSegments / namedCompetitors,
 * which older profiles lack), then force-rebuild every marked person's profile — staged
 * reasoning saved, rationale gate applied, stale un-muted axes detached.
 *
 * Dry run by default: prints who would be rebuilt and which employers re-researched.
 *
 *   node_modules/.bin/tsx scripts/radar-rebuild-people.ts --owner=<userId>
 *   node_modules/.bin/tsx scripts/radar-rebuild-people.ts --owner=<userId> --write
 *
 * Spend per run (no Apollo): ~1 news sweep + 1 profile call per employer, ~2 calls per
 * person (brain + rationale gate). For 3 employers + 4 people ≈ a few cents.
 */
import { prisma } from "@/lib/prisma";
import { researchTrackedCompany } from "@/lib/tech-radar/research-company";
import { buildProfilesForMarked } from "@/lib/tech-radar/build-profiles";
import { markedEmployers, upsertEmployers } from "@/lib/tech-radar/population";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const ownerId = arg("owner");
  const write = process.argv.includes("--write");
  if (!ownerId) {
    console.error("Usage: --owner=<userId> [--write]");
    process.exit(1);
  }

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { id: true, email: true, orgId: true },
  });
  if (!owner.orgId) throw new Error("owner has no org");

  const marked = await prisma.contact.findMany({
    where: { ownerId: owner.id, removedAt: null, radarInclude: true },
    select: { id: true, fullName: true, currentTitle: true, currentCompany: true },
  });

  console.log(`\nowner: ${owner.email}   org: ${owner.orgId}`);
  console.log(`mode:  ${write ? "WRITE" : "DRY RUN — nothing researched, nothing rebuilt"}\n`);
  console.log(`Marked people (${marked.length}):`);
  for (const m of marked) console.log(`  ${m.fullName} — ${m.currentTitle ?? "?"} @ ${m.currentCompany ?? "?"}`);

  const employers = await markedEmployers(owner.id);
  const upsert = await upsertEmployers(owner.orgId, employers);
  const tracked = await prisma.trackedCompany.findMany({
    where: { orgId: owner.orgId },
    select: { id: true, name: true, status: true },
  });
  const toResearch = tracked.filter((t) =>
    employers.some((e) => e.name.trim().toLowerCase() === t.name.trim().toLowerCase()) ||
    upsert.pendingResearch.includes(t.id)
  );

  console.log(`\nEmployers to RE-research (${toResearch.length}) — old profiles lack the commercial fields:`);
  for (const t of toResearch) console.log(`  ${t.name} [${t.status}]`);

  if (!write) {
    console.log("\nRe-run with --write to research + rebuild.\n");
    return;
  }

  // Serial on purpose: three companies, and the news providers rate-limit bursts.
  for (const t of toResearch) {
    const outcome = await researchTrackedCompany(t.id);
    console.log(`  researched ${t.name}: ${JSON.stringify(outcome)}`);
  }

  const report = await buildProfilesForMarked({ orgId: owner.orgId, ownerId: owner.id, force: true });
  console.log(`\nRebuild report:`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nNext: node_modules/.bin/tsx scripts/radar-verify-rebuild.ts --owner=${owner.id}\n`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
