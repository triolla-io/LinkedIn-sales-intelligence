/**
 * The driver for `radar.person-scan` — the ONLY way to fire the person-outward scan.
 *
 * `inngest/functions/tech-radar-person-scan.ts` registers the Inngest function, but
 * nothing in the app dispatches its trigger event ("the pilot ascends by hand" — see
 * the CLAUDE.md Inngest event index). Tonight's production run must be fired from
 * inside the prod container (see the "Prod container scripts" project memory: pipe a
 * tsx script into the app container and run it there so secrets stay on the box).
 * This script IS that driver — it calls `personScan()` directly, the same function the
 * Inngest handler calls, so a script run and an Inngest run behave identically.
 *
 * Dry run by default, exactly like scripts/radar-bootstrap.ts (same house style): it
 * prints the org, the ACTIVE axes with subscribers, each axis's kind and query count,
 * the total DISTINCT query strings the pool would ask for, and the per-provider quota
 * status from newsQuotaStatus() — then exits without a single provider call. That
 * number is what a human checks a quota against before spending it.
 *
 * --write calls personScan(orgId) for real: real news-provider spend (against the
 * quotas printed above) and real OpenRouter spend (triage + axis-fit + veto + draft,
 * against openrouterChat()'s own kill-switch and daily cap). It NEVER sends a message —
 * personScan stops at a PENDING_REVIEW/PREPARED draft; sending is a human action in the
 * app. Nothing in this script — dry run or --write — calls Apollo or Bright Data.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/radar-person-scan-run.ts --org=<orgId>            # dry run
 *   node_modules/.bin/tsx scripts/radar-person-scan-run.ts --org=<orgId> --write    # for real
 */
import { prisma } from "@/lib/prisma";
import { personScan, MAX_QUERIES_PER_AXIS, type PersonScanReport } from "@/lib/tech-radar/person-scan";
import { buildAxisQueryPool } from "@/lib/tech-radar/axis-fit";
import { normalizeQuery } from "@/lib/tech-radar/queries";
import { layer3Expired } from "@/lib/tech-radar/layers";
import { newsQuotaStatus } from "@/lib/news/budget";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function rule(s: string) {
  console.log(`\n${"═".repeat(78)}\n${s}\n${"═".repeat(78)}`);
}

/** "—" for anything absent/empty, so a field a given report shape doesn't carry never
 *  crashes the printer — it just reads as not-applicable. */
function show(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return Object.keys(v as object).length ? JSON.stringify(v) : "—";
  return String(v);
}

async function main() {
  const orgId = arg("org");
  const write = process.argv.includes("--write");
  if (!orgId) {
    console.error("Usage: --org=<orgId> [--write]");
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    console.error(`No org with id ${orgId}`);
    process.exit(1);
  }

  console.log(`\norg:  ${org.name} (${org.id})`);
  console.log(
    `mode: ${write ? "WRITE — will scan, judge, and draft for real (real spend)" : "DRY RUN — nothing written, no provider call made"}`
  );

  // ── The cohort/quota picture — always computed, dry run or not ────────────
  // Same query personScan() itself runs (lib/tech-radar/person-scan.ts, step 1): an
  // axis with no subscribers contributes no query, so it is excluded here too.
  const axes = await prisma.radarAxis.findMany({
    where: { orgId: org.id, status: "ACTIVE", people: { some: {} } },
    select: {
      id: true, label: true, kind: true, searchQueries: true,
      people: {
        select: {
          evidence: true,
          personProfile: { select: { contact: { select: { fullName: true } } } },
        },
      },
    },
    orderBy: { label: "asc" },
  });

  const now = new Date();
  const isPoolEligible = (people: { evidence: unknown }[]): boolean =>
    !(people.length > 0 && people.every((p) => layer3Expired(p.evidence, now)));

  rule(`ACTIVE AXES WITH SUBSCRIBERS (${axes.length})`);
  if (axes.length === 0) console.log("  none — nothing would be scanned.");
  for (const a of axes) {
    const eligible = isPoolEligible(a.people);
    const subs = a.people.map((p) => p.personProfile.contact.fullName);
    const queryCount = Math.min(
      new Set(a.searchQueries.map(normalizeQuery).filter(Boolean)).size,
      MAX_QUERIES_PER_AXIS
    );
    console.log(`\n  ${a.label}  [${a.kind}]${eligible ? "" : "  ⚠ layer-3 fact expired — excluded from this run's pool"}`);
    console.log(`    subscribers:  ${subs.join(", ") || "—"}`);
    console.log(`    query count:  ${queryCount} (capped at ${MAX_QUERIES_PER_AXIS}/axis)`);
  }

  const poolEligibleAxes = axes.filter((a) => isPoolEligible(a.people));
  const pool = buildAxisQueryPool(
    poolEligibleAxes.map((a) => ({ id: a.id, searchQueries: a.searchQueries })),
    normalizeQuery,
    MAX_QUERIES_PER_AXIS
  );

  rule("QUERY POOL");
  console.log(`  ${poolEligibleAxes.length}/${axes.length} axes pool-eligible (layer-3 query TTL applied)`);
  console.log(`  ${pool.length} DISTINCT query strings the pool would ask providers for`);

  rule("NEWS PROVIDER QUOTA");
  for (const p of ["serper", "serpapi", "gnews", "tavily"] as const) {
    const q = await newsQuotaStatus(p);
    console.log(
      `  ${p.padEnd(8)} window=${q.window} used=${q.used}${q.cap != null ? `/${q.cap}` : ""} remaining=${q.remaining ?? "unknown"}`
    );
  }

  if (!write) {
    console.log(`\nDRY RUN complete. No provider was called. Re-run with --write to scan for real.\n`);
    return;
  }

  // ── Real spend from here down ──────────────────────────────────────────────
  console.log(
    `\nAbout to fire personScan(${org.id}) for real: news-provider spend against the ${pool.length} ` +
      `queries above, plus OpenRouter spend for triage/axis-fit/veto/draft. It scans, judges, and ` +
      `drafts — it NEVER sends a message; drafts wait for a human in the app.\n`
  );

  let report: PersonScanReport;
  try {
    report = await personScan(org.id);
  } catch (err) {
    // A thrown scan (kill-switch, budget block, provider outage) must exit non-zero —
    // an empty EMPTY-shaped report and a crash must never look the same to whatever
    // is watching this process's exit code.
    console.error("\npersonScan threw — this is NOT a clean empty run:");
    console.error(err);
    process.exit(1);
  }

  rule("FUNNEL");
  console.log(`  scanned      ${show(report.poolItems)}`);
  console.log(`  topical      ${show(report.worthSharing)}`);
  console.log(`  important    ${show(report.itemsWritten)}`);
  console.log(`  connected    ${show(report.candidates)}`);
  console.log(`  drafts       ${show(report.drafted)}`);
  console.log(`  vetoed       ${show(report.vetoed)}`);

  rule("FRESHNESS SPREAD (days old)");
  console.log(
    `  freshest=${show(report.freshness?.freshest)}  median=${show(report.freshness?.median)}  oldest=${show(report.freshness?.oldest)}`
  );
  console.log(
    `  staleDropped=${show(report.staleDropped)}  undatedDropped=${show(report.undatedDropped)}  poolDropped=${show(report.poolDropped)}`
  );

  rule("DROP REASONS");
  const reasons = Object.entries(report.dropReasons ?? {}).sort((a, b) => b[1] - a[1]);
  if (reasons.length === 0) console.log("  —");
  for (const [reason, count] of reasons) console.log(`  ${String(count).padStart(4)}  ${reason}`);

  rule("TRIAGE BY KIND");
  if (!report.triageByKind?.length) console.log("  —");
  for (const t of report.triageByKind ?? []) console.log(`  ${t.kind.padEnd(24)} seen=${t.seen} passed=${t.passed}`);

  rule("LAYER CAKE");
  console.log(
    `  articlesByLayer: layer1=${show(report.articlesByLayer?.layer1)} layer3=${show(report.articlesByLayer?.layer3)} layer4=${show(report.articlesByLayer?.layer4)}`
  );
  console.log(`  expiredLayer3 (axes dropped from THIS pool, stale layer-3 fact): ${show(report.expiredLayer3)}`);

  rule("QUERIES");
  // cachedQueries lives on fetch-pool-news.ts's PoolResult, not on PersonScanReport —
  // it never made it onto the persisted report, so this always prints "—". Left in
  // deliberately rather than removed: the brief asked for it explicitly, and "—" here
  // is the honest answer, not a bug in this script.
  console.log(`  cachedQueries: ${show((report as unknown as Record<string, unknown>).cachedQueries)}`);
  console.log(`  uniqueQueries: ${show(report.uniqueQueries)}   queriesRun: ${show(report.queriesRun)}`);

  rule("PROVIDER STATS");
  if (!report.providerStats?.length) console.log("  —");
  for (const p of report.providerStats ?? []) console.log(`  ${JSON.stringify(p)}`);

  rule("ACCEPTANCE");
  console.log(
    `  met=${show(report.acceptance?.met)}  weighty=${show(report.acceptance?.weighty)}  ` +
      `israeliSource=${show(report.acceptance?.israeliSource)}  israelRelevant=${show(report.acceptance?.israelRelevant)}`
  );
  console.log(`  shortfall: ${show(report.acceptance?.shortfall) || "—"}`);

  console.log(`\nquotaExhausted: ${show(report.quotaExhausted)}`);
  console.log("\nDone. No message was sent — drafts wait for a human to read and send from the app.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
