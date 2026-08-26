/**
 * The pilot gate's release valve: hand a held draft over to its owner.
 *
 * A draft born while RADAR_PILOT_HOLD was on (the default) carries `pilotHeldAt` —
 * invisible on the owner's approvals screen until this script clears it. Dry-run by
 * default, in the house style of scripts/radar-mark.ts: the first thing you want from
 * this script is to see WHAT is about to reach someone's inbox, not a mutation.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/radar-release-drafts.ts --owner=<userId>
 *   npx tsx --env-file=.env scripts/radar-release-drafts.ts --ids=a,b --write
 *   npx tsx --env-file=.env scripts/radar-release-drafts.ts --owner=<id> --all --write
 *
 * Flags:
 *   --owner=  a user id — scopes to that owner's held drafts; alone (no --all, no
 *             --ids) this only LISTS them, even if --write is also passed, because
 *             there is nothing yet telling the script WHICH held rows to release.
 *   --ids=    comma-separated RadarDraft ids — release exactly these rows
 *   --all     combined with --owner: release every held draft that owner has
 *   --write   actually persist; without it nothing is written
 */
import { prisma } from "@/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Row = {
  id: string;
  createdAt: Date;
  confidence: number;
  draftMessage: string | null;
  pilotHeldAt: Date | null;
  contact: { fullName: string };
};

const select = {
  id: true,
  createdAt: true,
  confidence: true,
  draftMessage: true,
  pilotHeldAt: true,
  contact: { select: { fullName: true } },
} as const;

function describe(r: Row): string {
  const preview = (r.draftMessage ?? "").replace(/\s+/g, " ").slice(0, 120);
  const held = r.pilotHeldAt ? "[held]" : "[not held]";
  return `  ${r.contact.fullName} — ${r.createdAt.toISOString()} — confidence ${r.confidence.toFixed(2)} ${held}\n    id=${r.id}\n    "${preview}${preview.length === 120 ? "…" : ""}"`;
}

async function main() {
  const ownerId = arg("owner");
  const ids = splitList(arg("ids"));
  const all = process.argv.includes("--all");
  const write = process.argv.includes("--write");

  if (!ownerId && ids.length === 0) {
    console.error("Nothing to do: pass --owner=<userId> (to list) or --ids=a,b (to release), or --owner=<id> --all.");
    process.exit(1);
  }

  let rows: Row[] = [];
  // Explicit ids always win: the caller already knows exactly which rows they mean.
  let mode: "list" | "ids" | "all";

  if (ids.length > 0) {
    mode = "ids";
    rows = await prisma.radarDraft.findMany({
      where: { id: { in: ids }, ...(ownerId ? { ownerId } : {}) },
      select,
    });
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length > 0) {
      console.log(`NOT FOUND (${missing.length}) — these ids do not exist${ownerId ? " for this owner" : ""}:`);
      for (const id of missing) console.log(`  ${id}`);
    }
  } else if (ownerId && all) {
    mode = "all";
    rows = await prisma.radarDraft.findMany({
      where: { ownerId, pilotHeldAt: { not: null } },
      select,
      orderBy: { createdAt: "desc" },
    });
  } else {
    // --owner alone: list-only, on purpose. --write without --all or --ids would
    // otherwise have to guess a scope, and a wrong guess releases the wrong draft.
    mode = "list";
    rows = await prisma.radarDraft.findMany({
      where: { ownerId, pilotHeldAt: { not: null } },
      select,
      orderBy: { createdAt: "desc" },
    });
  }

  console.log(`\nMode:  ${mode === "list" ? "LIST ONLY (pass --all or --ids to release)" : write ? "WRITE" : "DRY RUN — nothing will be persisted"}`);
  console.log(`${rows.length} row(s) found:\n`);
  for (const r of rows) console.log(describe(r));
  console.log("");

  if (mode === "list") {
    console.log("Nothing released. Re-run with --owner=<id> --all --write, or --ids=a,b --write.\n");
    return;
  }

  const toRelease = rows.filter((r) => r.pilotHeldAt !== null);
  if (toRelease.length === 0) {
    console.log("None of these rows are currently held. Nothing to release.\n");
    return;
  }

  if (!write) {
    console.log(`Dry run complete. Re-run with --write to clear pilotHeldAt on ${toRelease.length} row(s).\n`);
    return;
  }

  const res = await prisma.radarDraft.updateMany({
    where: { id: { in: toRelease.map((r) => r.id) } },
    data: { pilotHeldAt: null },
  });
  console.log(`Released ${res.count} draft(s) — they will now appear on the owner's approvals screen.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
