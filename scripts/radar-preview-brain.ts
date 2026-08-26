/**
 * Preview the upgraded profile brain WITHOUT writing anything.
 *
 * Nothing here touches the database. The employer research runs in memory (so the
 * working stored profiles are not overwritten), feeds the person brain, the rationale
 * gate judges the proposals, and the 2026-08-26 fixtures run over the result. Then a
 * human reads it and decides whether a writing rebuild is worth doing.
 *
 * That ordering matters: previewing the brain against the OLD stored profiles would
 * test the new prompt on input that lacks whatTheySell / namedCompetitors, which is
 * exactly the deficiency the upgrade addresses.
 *
 *   node_modules/.bin/tsx scripts/radar-preview-brain.ts --owner=<userId>
 *   ... --contacts=id1,id2        preview a subset
 *   ... --json=/tmp/preview.json  also dump the raw proposals
 *
 * Spend per run (no Apollo): per employer one news sweep + one OpenRouter profile call;
 * per person one brain call + one gate call. For 3 employers and 4 people, a few cents.
 */
import { prisma } from "@/lib/prisma";
import { gatherCompanySources } from "@/lib/tech-radar/research-company";
import { researchProfile, missingResearchFields } from "@/lib/tech-radar/profile";
import { buildPersonProfile, type AxisProposal } from "@/lib/tech-radar/person-profile";
import { gateRationales } from "@/lib/tech-radar/rationale-gate";
import { runFixtures, type ProposedAxis } from "@/lib/tech-radar/rebuild-fixtures";
import { newsQuotaStatus } from "@/lib/news/budget";
import {
  MIN_AXES_PER_PERSON, thinProfiles, stageDistribution, sameDecisionCollisions, uniqueQueryCount,
} from "@/lib/tech-radar/profile-quality";
import { writeFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function rule(s: string) {
  console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);
}

async function main() {
  const ownerId = arg("owner");
  if (!ownerId) {
    console.error("Usage: --owner=<userId> [--contacts=a,b] [--json=<path>]");
    process.exit(1);
  }
  const only = (arg("contacts") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const owner = await prisma.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { id: true, email: true, orgId: true },
  });
  if (!owner.orgId) throw new Error("owner has no org");

  console.log(`\nPREVIEW ONLY — nothing will be written to the database.`);
  console.log(`owner: ${owner.email}   org: ${owner.orgId}`);

  const contacts = await prisma.contact.findMany({
    where: {
      ownerId: owner.id,
      removedAt: null,
      radarInclude: true,
      ...(only.length ? { id: { in: only } } : {}),
    },
    select: {
      id: true, fullName: true, currentTitle: true, headline: true, currentCompany: true,
      companyId: true, linkedinUrl: true,
    },
  });

  const employers = await prisma.trackedCompany.findMany({
    where: { orgId: owner.orgId },
    select: { id: true, name: true, aliases: true, companyId: true, website: true },
  });

  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  const employerFor = (c: (typeof contacts)[number]) =>
    employers.find(
      (e) =>
        (c.companyId != null && e.companyId === c.companyId) ||
        norm(e.name) === norm(c.currentCompany) ||
        e.aliases.some((a) => norm(a) === norm(c.currentCompany))
    );

  // ── 1. Research each needed employer ONCE, in memory ──────────────────────
  type Employer = (typeof employers)[number];
  const neededMap = new Map<string, Employer>();
  for (const c of contacts) {
    const e = employerFor(c);
    if (e) neededMap.set(e.id, e);
  }
  const needed = [...neededMap.values()];
  const freshProfiles = new Map<string, unknown>();

  rule(`1. EMPLOYER RESEARCH (in memory, ${needed.length} companies) — stored profiles untouched`);
  for (const e of needed) {
    try {
      const sources = await gatherCompanySources(e);
      const profile = await researchProfile({
        companyName: e.name,
        website: sources.website,
        pages: sources.pages,
        news: sources.news,
      });
      freshProfiles.set(e.id, profile);
      const missing = missingResearchFields(profile);
      console.log(`\n■ ${e.name}`);
      console.log(`  pages read: ${sources.pages.length}   news: ${sources.news.length}`);
      console.log(`  whatTheySell:     ${profile.whatTheySell || "(empty)"}`);
      console.log(`  customerSegments: ${profile.customerSegments.join(", ") || "(empty)"}`);
      console.log(
        `  namedCompetitors: ${
          profile.namedCompetitors.join(", ") ||
          (profile.noClearCompetitors ? `(none — finding: ${profile.noCompetitorsReason})` : "(EMPTY, undeclared)")
        }`
      );
      if (missing.length) console.log(`  ⚠ would FAIL research: missing ${missing.join(", ")}`);
    } catch (err) {
      console.log(`\n■ ${e.name}\n  research FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 2. The brain, per person, on the fresh research ───────────────────────
  rule("2. PROPOSED PERSON MODEL — read this against what Yuval actually said");
  const dump: unknown[] = [];
  // Collected across people: a same-decision collision is only visible between two of them.
  const cohort: { name: string; employerId: string; axes: AxisProposal[] }[] = [];

  for (const c of contacts) {
    const employer = employerFor(c);
    console.log(`\n${"─".repeat(78)}`);
    console.log(`${c.fullName} — ${c.currentTitle ?? "?"} @ ${c.currentCompany ?? "?"}`);
    console.log(`${"─".repeat(78)}`);

    if (!employer || !freshProfiles.has(employer.id)) {
      console.log("  skipped: no researched employer in this preview");
      continue;
    }

    const draft = await buildPersonProfile({
      fullName: c.fullName,
      currentTitle: c.currentTitle,
      headline: c.headline,
      companyName: employer.name,
      employerProfile: freshProfiles.get(employer.id),
    });
    if (!draft) {
      console.log("  brain call failed or returned no reasoning");
      continue;
    }

    console.log(`\n  roleLens: ${draft.roleLens}`);
    console.log(`\n  REASONING (the staged thinking):`);
    for (const line of draft.reasoning.split(/(?=\([אבגדה]\))/)) {
      if (line.trim()) console.log(`    ${line.trim()}`);
    }

    const facts = freshProfiles.get(employer.id) as
      | { namedCompetitors?: string[]; customerSegments?: string[] }
      | undefined;
    const gate = await gateRationales(draft.roleLens, draft.axes, {
      namedCompetitors: facts?.namedCompetitors ?? [],
      customerSegments: facts?.customerSegments ?? [],
      reasoning: draft.reasoning,
    });
    if (!gate.judged) console.log(`\n  ⚠ rationale gate call failed — nothing was filtered`);

    console.log(`\n  PROPOSED AXES (${gate.kept.length} kept, ${gate.rejected.length} rejected by the gate):`);
    for (const a of gate.kept) {
      // The stage tag and the crossing are the whole point of the 2026-08-26 rework:
      // "derived from the role and the company" is a tag that distinguishes nothing, and
      // a rationale naming one side is an admission that no crossing happened.
      console.log(`    · ${a.label}${a.agenda ? "   [agenda]" : ""}   [${a.stage}]`);
      console.log(`      crossing: ${a.personDecision}  ×  ${a.companyFact}`);
      console.log(`      why him: ${a.rationale}`);
      console.log(`      queries: ${a.searchQueries.join(" | ")}`);
    }
    for (const r of gate.rejected) {
      console.log(`    ✗ ${r.label} — REJECTED [${r.reason}]: "${r.rationale}"`);
    }
    if (Object.keys(gate.deterministic).length > 0) {
      console.log(`\n  deterministic rejections: ${JSON.stringify(gate.deterministic)}`);
    }

    const axes: ProposedAxis[] = gate.kept.map((a) => ({
      label: a.label,
      rationale: a.rationale,
      queries: a.searchQueries,
    }));
    const fx = runFixtures(c.linkedinUrl ?? "", axes);
    if (fx.checks.length > 0) {
      console.log(`\n  SMOKE TEST — keyword checks only, NOT proof the axes are right:`);
      for (const ch of fx.checks) {
        console.log(`    ${ch.clean ? "○" : "●"} ${ch.verdict} — ${ch.describe}`);
        if (ch.matched.length) console.log(`        matched: ${ch.matched.join(" / ")}`);
      }
    }

    if (gate.kept.length < MIN_AXES_PER_PERSON) {
      console.log(
        `\n  ⚠ THIN PROFILE — ${gate.kept.length} axes, floor is ${MIN_AXES_PER_PERSON}. Elinor came back from` +
          ` the 2026-08-26 rebuild with two axes, one of them not even hers, and the run said "done".`
      );
    }

    cohort.push({ name: c.fullName, employerId: employer.id, axes: gate.kept });
    dump.push({ contactId: c.id, fullName: c.fullName, draft, gate, fixtures: fx });
  }

  // ── 2b. The four numbers ─────────────────────────────────────────────────
  rule("THE FOUR NUMBERS");
  const allAxes = cohort.flatMap((k) => k.axes);
  const stages = stageDistribution(allAxes);
  console.log(`  stage distribution (${allAxes.length} axes over ${cohort.length} people):`);
  for (const [stage, n] of Object.entries(stages)) {
    // adopt at 0 across the whole cohort is the signal that stage (ד) did not land.
    const flag = stage === "adopt" && n === 0 ? "   ← stage (ד) produced nothing" : "";
    console.log(`    ${stage.padEnd(14)} ${n}${flag}`);
  }

  const thin = thinProfiles(cohort);
  console.log(`\n  thin profiles (under ${MIN_AXES_PER_PERSON} axes): ${thin.length === 0 ? "none" : ""}`);
  for (const t of thin) console.log(`    ⚠ ${t.name}: ${t.axes} axes`);

  const collisions = sameDecisionCollisions(cohort);
  console.log(`\n  same decision handed to two people at ONE employer: ${collisions.length === 0 ? "none" : ""}`);
  for (const c2 of collisions) {
    console.log(`    ⚠ ${c2.people.join(" + ")} — "${c2.decision}"`);
  }

  // Distinct query strings, which is what actually gets billed: two axes asking the same
  // string are one fetched query. 34 is what the 2026-08-26 scan ran.
  const unique = uniqueQueryCount(allAxes);
  const delta = unique - 34;
  console.log(
    `\n  unique queries: ${unique} vs 34 in the 2026-08-26 run  (${delta >= 0 ? "+" : ""}${delta}` +
      `${delta === 0 ? "" : `, ${((delta / 34) * 100).toFixed(0)}%`})`
  );
  console.log(`  axesRefused: only the WRITING rebuild can report it — no axis is attached here.`);

  // ── 3. What the run cost in provider quota ───────────────────────────────
  rule("3. NEWS QUOTA AFTER THIS PREVIEW");
  for (const p of ["serper", "serpapi", "gnews", "tavily"] as const) {
    const q = await newsQuotaStatus(p);
    console.log(
      `  ${p.padEnd(8)} window=${q.window} used=${q.used}${q.cap != null ? `/${q.cap}` : ""} remaining=${q.remaining ?? "unknown"}`
    );
  }

  const jsonPath = arg("json");
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(dump, null, 2));
    console.log(`\nRaw proposals written to ${jsonPath}`);
  }

  console.log(`\nNOTHING WAS WRITTEN. A writing rebuild is a separate, explicitly approved step.\n`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
