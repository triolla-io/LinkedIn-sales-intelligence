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
import { runFixtures, type ProposedAxis, type ProposedDomain } from "@/lib/tech-radar/rebuild-fixtures";
import type { PersonAudience, PersonScope } from "@/lib/tech-radar/person-profile";
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

/** A Json column that holds a record, not null / a scalar / an array. */
function isObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One line for the readout: "B2C, B2B · משקי בית · ישראל", or the absence, said out loud. */
function audienceLine(a: PersonAudience | null): string {
  if (!a) return "— none (profile built before the person model, or the build skipped it)";
  const types = Array.isArray(a.type) ? a.type.join(", ") : "";
  const line = [types, a.who, a.geography]
    .filter((s) => typeof s === "string" && s.trim() !== "")
    .join(" · ");
  // A present-but-empty audience is not the same finding as a missing one, so it gets its
  // own mark rather than printing as a blank after the label.
  return line || "— present but empty";
}

/**
 * owns / notOwns on one line. Both halves always print, empty included: `notOwns` is the
 * deterministic prefilter that drops a story about a line the person does not hold, so an
 * empty one is a real finding about the rebuild, not a blank worth hiding.
 */
function scopeLine(s: PersonScope | null): string {
  const list = (xs: string[] | undefined) => (xs?.length ? xs.join(" · ") : "—");
  return `owns: ${list(s?.owns)}   |   notOwns: ${list(s?.notOwns)}`;
}

/**
 * `PersonProfile.domains` read back as the layer-4 fields of work, tagged found/derived
 * (Task 9). Read alongside the axes so the BEFORE/AFTER comparison can show the layer
 * cake's own output, not just what it produced axes from — a rebuild that raises the
 * axis count on a wholly-derived domain list is not the improvement it looks like.
 *
 * `audience` and `scope` ride along for the same reason, and are the two the human
 * approving this rebuild is really reading: whose customers the person serves, and which
 * business lines are on and off their desk. Omitting them from the comparison would leave
 * the whole point of the rebuild invisible in the very readout that authorises it — and a
 * missing `audience` after a rebuild is itself the finding (the build never answered
 * "whose customers are these", which is the failure the field exists to expose).
 */
async function readModel(
  ownerId: string
): Promise<
  Map<
    string,
    {
      name: string;
      slug: string;
      axes: AxisRow[];
      domains: ProposedDomain[];
      audience: PersonAudience | null;
      scope: PersonScope | null;
    }
  >
> {
  const profiles = await prisma.personProfile.findMany({
    where: { contact: { ownerId } },
    select: {
      contactId: true, domains: true, audience: true, scope: true,
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
        domains: Array.isArray(p.domains) ? (p.domains as unknown as ProposedDomain[]) : [],
        // Legacy rows have neither — read as null so the readout can say "none" out loud
        // instead of printing an empty line that reads like an answer. Same defensive
        // shape as `domains`: whatever is in the Json column, never trusted blindly.
        audience: isObject(p.audience) ? (p.audience as unknown as PersonAudience) : null,
        scope: isObject(p.scope) ? (p.scope as unknown as PersonScope) : null,
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

    // Layer 4's own output, not just what it produced axes from — see readModel's
    // comment. `found` came from the person's own data (title/headline/about/
    // experience/post); `derived` is an inference from role × company. A rebuild that
    // produced zero found domains modelled this person entirely from a guess.
    const domains: ProposedDomain[] = next?.domains ?? [];
    const foundCount = domains.filter((d) => d.kind === "found").length;
    const derivedCount = domains.filter((d) => d.kind === "derived").length;
    console.log(`\n  domains: ${foundCount} found / ${derivedCount} derived`);
    if (foundCount === 0) console.log(`  ⚠ כולו נגזר`);

    // Research findings, per person, right where the human is already looking. Zero here
    // explains every generic axis below it: the model saw the title and the employer and
    // nothing about the human. Printed even though the JSON report carries it, because a
    // number nobody scrolls to is a number nobody reads.
    const res = report.researchByPerson.find((r) => r.name === prev.name);
    console.log(
      `  research: ${res?.findings ?? 0} findings (${res?.paidQueries ?? 0} paid queries, ${res?.discarded ?? 0} about the employer only)`
    );
    if (!res || res.findings === 0) console.log(`  ⚠ אפס מחקר — המודל נבנה מהתפקיד בלבד`);

    // The two fields the approval actually turns on, before → after. Printed for every
    // person even when unchanged: "the audience did not move" is exactly what a reader
    // checking a rebuild needs to be able to see, and a line that only appears on change
    // cannot be distinguished from a line that was forgotten.
    console.log(`\n  audience  before: ${audienceLine(prev.audience)}`);
    console.log(`            after:  ${audienceLine(next?.audience ?? null)}`);
    if (!next?.audience) console.log(`  ⚠ אין קהל — הבנייה לא ענתה למי האדם הזה מוכר`);
    console.log(`  scope     before: ${scopeLine(prev.scope)}`);
    console.log(`            after:  ${scopeLine(next?.scope ?? null)}`);

    const axes: ProposedAxis[] = (next?.axes ?? [])
      .filter((a) => !a.muted)
      .map((a) => ({ label: a.label, rationale: a.rationale, queries: a.queries }));
    const fx = runFixtures(next?.slug ?? prev.slug, axes, domains);
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
