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
 * prints the org, the ACTIVE axes with subscribers, the SOURCE PACKS the scan would pull
 * (free — RSS, no quota), the DISTINCT queries the narrow named channel would buy, and
 * the per-provider quota status from newsQuotaStatus() — then exits without a single
 * provider call. That last number is what a human checks a quota against before spending
 * it, and after Phase B it is the ONLY billable part of the intake: the packs cost
 * nothing, so a big pack pull is not a big bill.
 *
 * --write calls personScan(orgId) for real: real news-provider spend (against the
 * quotas printed above) and real OpenRouter spend (triage + chooser + veto + draft,
 * against openrouterChat()'s own kill-switch and daily cap). It NEVER sends a message —
 * personScan stops at a PENDING_REVIEW/PREPARED draft; sending is a human action in the
 * app. Nothing in this script — dry run or --write — calls Apollo or Bright Data.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/radar-person-scan-run.ts --org=<orgId>            # dry run
 *   node_modules/.bin/tsx scripts/radar-person-scan-run.ts --org=<orgId> --write    # for real
 */
import { prisma } from "@/lib/prisma";
import { personScan, poolQueryCount, type PersonScanReport } from "@/lib/tech-radar/person-scan";
import { resolvePacksForOrg } from "@/lib/tech-radar/source-packs";
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
      id: true, label: true, kind: true,
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
    // Phase B: an axis no longer writes queries. It is a CLASSIFICATION tag, and only a
    // PERSON_ENTITY axis (a name) or a company monitor buys anything at all — through the
    // narrow named channel below.
    console.log(`\n  ${a.label}  [${a.kind}]${eligible ? "" : "  ⚠ layer-3 fact expired — buys no named query this run"}`);
    console.log(`    subscribers:  ${subs.join(", ") || "—"}`);
  }

  // ── The free half: which fixed source packs would be pulled ──────────────
  const resolution = await resolvePacksForOrg(org.id);
  rule(`SOURCE PACKS (free — RSS, no quota)`);
  if (resolution.packs.length === 0) console.log("  none — no industry pack resolved, so no outlet would be pulled.");
  for (const pack of resolution.packs) {
    const enabled = pack.sources.filter((x) => x.enabled);
    const il = enabled.filter((x) => x.scope === "il").length;
    console.log(
      `  ${(pack.label ?? pack.industryKey).padEnd(28)} sources=${enabled.length} (il=${il} global=${enabled.length - il}) tags=${pack.taxonomy.length}`
    );
  }
  // Never a silent zero: an industry whose people would get nothing is named, which is the
  // failure shape this codebase has hit repeatedly ("0 נמצאו" that was 25 filtered people).
  for (const u of resolution.unresolved) {
    console.log(`  ⚠ ${u.labels.join(" / ") || u.industryKey}: NO USABLE PACK (${u.reason}) — ${u.people} person(s) affected`);
  }
  for (const u of resolution.noSubscribers) {
    console.log(`  · ${u.labels.join(" / ") || u.industryKey}: every subscription muted — represents nobody this scan`);
  }
  for (const u of resolution.unkeyed) {
    console.log(`  ⚠ axis ${u.axisId} ("${u.label}") normalises to no industry at all — a bug report, not a routine outcome`);
  }

  // ── The paid half: the narrow named channel ──────────────────────────────
  const pool = { length: (await poolQueryCount(org.id)).uniqueQueries };
  rule("NARROW NAMED CHANNEL (the only billable intake)");
  console.log(`  ${pool.length} DISTINCT queries, built in code from competitor/product and employer NAMES`);
  console.log(`  no LLM writes any of them — the free-text axis queries of v2 are gone`);
  // POOL_RETRY (see CLAUDE.md "Temporary env overrides"): the pool count above is per
  // QUERY, not per PROVIDER CALL. An empty result retries once, broader, UNLESS
  // POOL_RETRY=off — so real spend can reach up to 2x the query count above, not the
  // query count itself. Deliberately NOT computed as a worst-case doubled number here:
  // most queries do not come back empty, so a flat 2x would overstate spend as often as
  // the raw count understates it. Printing the setting plainly is the honest version —
  // it lets whoever reads this before --write reason about the real risk themselves.
  const poolRetryOff = (process.env.POOL_RETRY ?? "").trim().toLowerCase() === "off";
  console.log(
    `  POOL_RETRY: ${poolRetryOff ? "off — one provider call per query, no retry" : "on (default) — an empty query retries once broader: real spend can reach up to 2x the count above"}`
  );

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
      `named queries above (the pack pull is free), plus OpenRouter spend for triage/chooser/veto/draft. ` +
      `It scans, judges, and drafts — it NEVER sends a message; drafts wait for a human in the app.\n`
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

  rule("SOURCES PULLED");
  // Rollout step 3 reads THIS before the weekly tick is allowed to run: an empty pull has
  // to be able to say WHICH outlet went quiet, which is the 2026-08-27 lesson (one
  // provider silently dropped 100% of its results and it read as a quiet week).
  if (!report.perSource?.length) console.log("  —");
  for (const s of report.perSource ?? []) {
    console.log(
      `  ${s.host.padEnd(24)} items=${String(s.items).padStart(3)}  via=${s.via}` +
        `${s.wrapperDrops ? `  wrapperDrops=${s.wrapperDrops}` : ""}${s.error ? `  ERROR: ${s.error}` : ""}`
    );
  }
  for (const p of report.sourcePacks ?? []) {
    console.log(`  pack ${(p.label ?? p.industryKey).padEnd(24)} sources=${p.sources} tags=${p.taxonomyTags} items=${p.items}`);
  }
  for (const u of report.unresolvedIndustries ?? []) {
    console.log(`  ⚠ ${u.labels.join(" / ") || u.industryKey}: ${u.reason} (${u.people} person(s))`);
  }

  rule("MATCHING FLOORS");
  console.log(`  people scanned:      ${show(report.peopleScanned)}`);
  console.log(`  candidates (floors): ${show(report.floorCandidates)}`);
  console.log(`  chooser calls:       ${show(report.chooserCalls)}   picks: ${show(report.chooserPicks)}`);
  console.log(`  dropouts saved:      ${show(report.dropoutsWritten)}`);
  const floors = Object.entries(report.floorDrops ?? {}).sort((a, b) => b[1] - a[1]);
  if (floors.length === 0) console.log("  drops: —");
  for (const [floor, count] of floors) console.log(`  ${String(count).padStart(4)}  ${floor}`);
  // A SKIPPED gate is not a passed gate. Whoever reads "0 geography drops" has to know
  // whether the gate ran at all for the people in this run.
  console.log(`  geography gate SKIPPED for: ${show(report.geoGateSkipped)}`);
  console.log(`  people with no source pack: ${show(report.peopleWithoutPack)}`);

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

  rule("NAMED QUERIES");
  // cachedQueries now lives on PersonScanReport too (2026-08-26 final review, Finding 5) —
  // threaded from fetch-pool-news.ts's PoolResult the same way freshness/uniqueQueries
  // are. This is the number that tells a re-fired scan (within the query cache's
  // EMPTY_CACHE_TTL_MINUTES window) apart from a genuinely quiet week.
  console.log(`  cachedQueries: ${show(report.cachedQueries)}`);
  console.log(`  namedQueries:  ${show(report.namedQueries)}`);
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
