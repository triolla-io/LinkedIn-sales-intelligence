/**
 * Exercises stages 2-5 plus drafting against REAL LLM calls and REAL contacts, with the
 * news fetch stubbed out.
 *
 * Why this exists: during bring-up every external news source was exhausted at once
 * (Tavily plan limit 432, GNews daily 403), which blocks a full green run for reasons
 * that have nothing to do with the pipeline. Feeding in coverage captured earlier from
 * the live pool separates "the pipeline works" from "the taps are closed".
 *
 *   npx tsx --env-file=.env scripts/tech-radar-stubbed-scan.ts
 */
import { prisma } from "@/lib/prisma";
import { triageAll, type PoolItem } from "@/lib/tech-radar/triage";
import { synthesizeItem } from "@/lib/tech-radar/item";
import { prefilterItems, judgeFit, type FitItem } from "@/lib/tech-radar/fit";
import { allocateWeeklyCap } from "@/lib/tech-radar/cap";
import { upsertTechItem, createOpportunities, findDraftableOpportunityIds } from "@/lib/tech-radar/persist";
import { createDraftsForOpportunity } from "@/lib/tech-radar/create-drafts";
import { isUsableProfile, type TechRadarProfile } from "@/lib/tech-radar/types";

/** Real headlines captured from the live GNews pool earlier tonight. */
const CAPTURED: PoolItem[] = [
  {
    title: "Razorpay Launches AI-Powered 'Vulcan' With NVIDIA, AWS To Boost Payment Reliability And Fraud Detection",
    url: "https://example-news.test/razorpay-vulcan",
    snippet:
      "Razorpay has launched Vulcan, an AI foundation model built with NVIDIA and AWS, for intelligent payment routing, real-time fraud detection and improved transaction success rates for banks and merchants.",
    publishedAt: "2026-08-12",
  },
  {
    title: "Axis Finance launches 'Drishti' digital platform to automate credit decisioning and retail lending",
    url: "https://example-news.test/axis-drishti",
    snippet:
      "Axis Finance introduced Drishti, a digital platform that automates credit decisioning, underwriting and disbursal for retail and MSME lending, cutting approval times from days to minutes.",
    publishedAt: "2026-08-10",
  },
  {
    title: "Zeotap launches end-to-end Composable CDP Native App",
    url: "https://example-news.test/zeotap-cdp",
    snippet:
      "Zeotap released a composable customer data platform that runs natively on a company's existing data warehouse, unifying customer profiles for segmentation and personalisation without copying data out.",
    publishedAt: "2026-08-08",
  },
  {
    title: "How Fraud Detection Algorithms Work: A Guide for the US Financial Market",
    url: "https://example-news.test/fraud-guide",
    snippet: "An explainer covering how fraud detection algorithms score transactions and what consumers should know.",
    publishedAt: "2026-08-11",
  },
  {
    title: "ANMI urges govt to cut STT or scrap LTCG tax to boost retail participation in stock markets",
    url: "https://example-news.test/anmi-tax",
    snippet: "An industry body has asked the government to reduce securities transaction tax.",
    publishedAt: "2026-08-09",
  },
];

function head(s: string) {
  console.log(`\n${"─".repeat(70)}\n${s}\n${"─".repeat(70)}`);
}

async function main() {
  const company = await prisma.trackedCompany.findFirstOrThrow({
    select: { id: true, orgId: true, name: true, profile: true },
  });
  if (!isUsableProfile(company.profile)) throw new Error("company has no usable profile");
  const profile = company.profile as TechRadarProfile;
  console.log(`company: ${company.name} — ${profile.focusAreas.length} focus areas`);

  head("STAGE 2 — shared launch triage (is this a launch at all?)");
  const verdicts = await triageAll(CAPTURED);
  for (const v of verdicts) {
    console.log(`  ${v.isLaunch ? "LAUNCH  " : "reject  "} ${v.technology ?? "-"} | ${v.categories.join(", ")}`);
  }
  const launches = verdicts.filter((v) => v.isLaunch);
  console.log(`\n${launches.length} launches of ${verdicts.length} judged`);

  head("STAGE 3 — write each launch up once (shared TechItem)");
  const items: FitItem[] = [];
  for (const v of launches) {
    const article = CAPTURED.find((c) => c.url === v.url)!;
    const draft = await synthesizeItem({
      triage: v,
      articles: [{ url: article.url, title: article.title, snippet: article.snippet, publishedAt: article.publishedAt }],
      pages: [], // no page reads: the point here is stages 2-5, not the reader
    });
    const itemId = await upsertTechItem(draft);
    items.push({
      itemId,
      vendor: draft.vendor,
      technology: draft.technology,
      title: draft.title,
      summary: draft.summary,
      categories: draft.categories,
    });
    console.log(`  ${draft.technology} (${draft.vendor ?? "?"}) -> ${itemId}`);
  }

  head("STAGE 4 — per-company fit");
  const shortlist = prefilterItems(profile, items);
  console.log(`prefilter kept ${shortlist.length} of ${items.length}`);
  const candidates = [];
  for (const item of shortlist) {
    const verdict = await judgeFit(profile, company.name, item);
    console.log(`  ${verdict.fits ? "FITS " : "no   "} [${verdict.score.toFixed(2)}] ${item.technology}`);
    if (verdict.fits) console.log(`         ${verdict.fitRationale}`);
    if (verdict.fits) {
      candidates.push({
        trackedCompanyId: company.id,
        itemId: item.itemId,
        fitRationale: verdict.fitRationale,
        score: verdict.score,
      });
    }
  }

  head("STAGE 5 — cap and persist");
  const kept = allocateWeeklyCap(candidates);
  const created = await createOpportunities(kept);
  console.log(`${candidates.length} candidates -> ${kept.length} after cap -> ${created} new opportunities`);

  head("DRAFTS — real senior contacts, real Hebrew messages");
  const draftable = await findDraftableOpportunityIds(company.id);
  for (const id of draftable) {
    const res = await createDraftsForOpportunity(id);
    console.log(`  opportunity ${id}: ${res.created} drafts`);
  }

  const drafts = await prisma.techOpportunityDraft.findMany({
    where: { opportunity: { trackedCompanyId: company.id } },
    select: {
      draftMessage: true, status: true,
      contact: { select: { fullName: true, currentTitle: true } },
      opportunity: { select: { fitRationale: true, item: { select: { technology: true } } } },
    },
  });
  console.log(`\n${drafts.length} drafts total:`);
  for (const d of drafts) {
    console.log(`\n  → ${d.contact.fullName} · ${d.contact.currentTitle ?? "?"}   [${d.opportunity.item.technology}]`);
    console.log(`    ${d.draftMessage}`);
  }

  head("DONE");
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
