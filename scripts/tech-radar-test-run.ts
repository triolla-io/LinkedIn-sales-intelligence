/**
 * End-to-end live run of the Tech Radar for ONE company, without Inngest.
 *
 * Calls the same library functions the Inngest functions call, in the same order, so a
 * green run here means the real pipeline works. Spends real money: OpenRouter (Haiku)
 * plus Tavily/GNews quota. No Apollo.
 *
 *   npx tsx --env-file=.env scripts/tech-radar-test-run.ts "בנק הפועלים" bankhapoalim.co.il
 */
import { prisma } from "@/lib/prisma";
import { researchTrackedCompany } from "@/lib/tech-radar/research-company";
import { scanOrg } from "@/lib/tech-radar/scan";
import { findDraftableOpportunityIds } from "@/lib/tech-radar/persist";
import { createDraftsForOpportunity } from "@/lib/tech-radar/create-drafts";

const name = process.argv[2] ?? "בנק הפועלים";
const website = process.argv[3] ?? null;
const relationship = (process.argv[4] as "CUSTOMER" | "PROSPECT") ?? "PROSPECT";

function head(s: string) {
  console.log(`\n${"─".repeat(70)}\n${s}\n${"─".repeat(70)}`);
}

async function main() {
  const org = await prisma.organization.findFirstOrThrow({ select: { id: true, name: true } });
  console.log(`org: ${org.name} (${org.id})`);

  head(`1. TRACKED COMPANY — ${name}`);
  const company = await prisma.trackedCompany.upsert({
    where: { orgId_name: { orgId: org.id, name } },
    update: { website, relationship },
    create: { orgId: org.id, name, website, relationship, status: "PENDING_RESEARCH" },
    select: { id: true, name: true, relationship: true },
  });
  console.log(`id=${company.id} relationship=${company.relationship}`);

  head("2. RESEARCH — read the site + coverage, build the profile");
  const outcome = await researchTrackedCompany(company.id);
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status !== "ACTIVE") {
    console.log("\nResearch failed — the company is NOT ACTIVE, so it will never be scanned.");
    return;
  }

  const withProfile = await prisma.trackedCompany.findUniqueOrThrow({
    where: { id: company.id },
    select: { profile: true },
  });
  const p = withProfile.profile as {
    businessLines: { name: string }[];
    focusAreas: { area: string; why: string }[];
    searchQueries: string[];
    techStack: string[];
    sources: { url: string }[];
  };
  console.log("\nbusiness lines :", p.businessLines.map((b) => b.name).join(" | "));
  console.log("tech stack     :", p.techStack.join(", ") || "(none)");
  console.log("focus areas    :");
  for (const f of p.focusAreas) console.log(`  · ${f.area} — ${f.why}`);
  console.log("search queries :");
  for (const q of p.searchQueries) console.log(`  · ${q}`);
  console.log("sources read   :", p.sources.length);

  head("3. SCAN — pooled queries, triage, write-ups, fit, cap");
  const report = await scanOrg(org.id);
  console.log(JSON.stringify(report, null, 2));
  if (report.quotaExhausted) console.log("\n⚠ every provider returned empty — news quota, not an empty week");

  const opportunities = await prisma.techOpportunity.findMany({
    where: { trackedCompanyId: company.id },
    orderBy: { score: "desc" },
    select: {
      id: true, fitRationale: true, score: true,
      item: { select: { vendor: true, technology: true, title: true, summary: true, thin: true, categories: true } },
    },
  });
  console.log(`\n${opportunities.length} opportunities:`);
  for (const o of opportunities) {
    console.log(`\n  [${o.score.toFixed(2)}] ${o.item.technology}${o.item.vendor ? ` · ${o.item.vendor}` : ""}${o.item.thin ? "  (thin)" : ""}`);
    console.log(`      ${o.item.title}`);
    console.log(`      tags: ${o.item.categories.join(", ")}`);
    console.log(`      WHY : ${o.fitRationale}`);
  }

  head("4. DRAFTS — pick senior contacts, write the messages");
  const draftable = await findDraftableOpportunityIds(company.id);
  console.log(`${draftable.length} opportunities awaiting drafts`);
  for (const id of draftable) {
    const res = await createDraftsForOpportunity(id);
    console.log(`  ${id} -> ${res.created} drafts across ${res.owners} owners`);
  }

  const drafts = await prisma.techOpportunityDraft.findMany({
    where: { opportunity: { trackedCompanyId: company.id } },
    select: {
      draftMessage: true, status: true,
      contact: { select: { fullName: true, currentTitle: true } },
      opportunity: { select: { item: { select: { technology: true } } } },
    },
  });
  console.log(`\n${drafts.length} drafts:`);
  for (const d of drafts) {
    console.log(`\n  → ${d.contact.fullName} · ${d.contact.currentTitle ?? "?"}  [${d.opportunity.item.technology}]`);
    console.log(`    ${d.draftMessage}`);
  }

  head("DONE");
}

main()
  .catch((e) => {
    console.error("\nRUN FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
