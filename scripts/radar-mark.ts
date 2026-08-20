/**
 * Mark contacts for a person-first radar run.
 *
 * This is the input side of the Phase A smoke test: you pick the people, and
 * `createDraftsForOpportunity` then drafts to THEM instead of to whoever the ranker
 * considers senior at their company. A mark also bypasses the seniority gate — the
 * whole point of marking someone is that the automatic rule would not have chosen them.
 *
 * Dry run by default, like scripts/radar-bootstrap.ts. The first thing you want from
 * this script is confirmation that the names resolved to the people you meant, not a
 * mutation — a wrong match here sends a message to a stranger.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/radar-mark.ts --owner=<userId> --names="Dana Cohen, Yossi Levi"
 *   npx tsx --env-file=.env scripts/radar-mark.ts --owner=<userId> --names="..." --write
 *   npx tsx --env-file=.env scripts/radar-mark.ts --owner=<userId> --ids=abc,def --write
 *   npx tsx --env-file=.env scripts/radar-mark.ts --owner=<userId> --ids=abc --off --write
 *   npx tsx --env-file=.env scripts/radar-mark.ts --owner=<userId> --ids=abc --exclude --write
 *
 * Flags:
 *   --names=  comma-separated full names, matched case-insensitively and exactly
 *   --ids=    comma-separated contact ids (use this to resolve an ambiguous name)
 *   --write   actually persist; without it nothing is written
 *   --off     clear the mark back to null (follow the automatic cohort rule again)
 *   --exclude mark as never-contact (radarInclude = false)
 *   --list    show everyone currently marked for this owner, then exit
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
  fullName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  radarInclude: boolean | null;
};

function describe(r: Row): string {
  const mark = r.radarInclude === true ? "[marked]" : r.radarInclude === false ? "[excluded]" : "";
  return `  ${r.fullName} — ${r.currentTitle ?? "?"} @ ${r.currentCompany ?? "?"}  ${mark}\n    id=${r.id}`;
}

async function main() {
  const ownerId = arg("owner");
  const names = splitList(arg("names"));
  const ids = splitList(arg("ids"));
  const write = process.argv.includes("--write");
  const off = process.argv.includes("--off");
  const exclude = process.argv.includes("--exclude");
  const list = process.argv.includes("--list");

  if (!ownerId) {
    console.error("Missing --owner=<userId>.");
    process.exit(1);
  }
  if (off && exclude) {
    console.error("--off and --exclude are mutually exclusive: one clears the mark, the other sets a never-contact mark.");
    process.exit(1);
  }

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true },
  });
  if (!owner) {
    console.error(`No user with id ${ownerId}`);
    process.exit(1);
  }

  const select = {
    id: true,
    fullName: true,
    currentTitle: true,
    currentCompany: true,
    radarInclude: true,
  } as const;

  if (list) {
    const marked = await prisma.contact.findMany({
      where: { ownerId: owner.id, removedAt: null, NOT: { radarInclude: null } },
      select,
      orderBy: { fullName: "asc" },
    });
    console.log(`\n${owner.email} — ${marked.length} contacts carry an explicit mark:\n`);
    for (const r of marked) console.log(describe(r));
    console.log("");
    return;
  }

  if (names.length === 0 && ids.length === 0) {
    console.error("Nothing to do: pass --names=\"A, B\" or --ids=a,b (or --list).");
    process.exit(1);
  }

  const target = off ? null : exclude ? false : true;
  const label = off ? "cleared (follow the cohort rule)" : exclude ? "EXCLUDED (never contact)" : "MARKED (always include)";

  console.log(`\nOwner: ${owner.email}`);
  console.log(`Mode:  ${write ? "WRITE" : "DRY RUN — nothing will be persisted"}`);
  console.log(`Will set radarInclude = ${JSON.stringify(target)}  → ${label}\n`);

  const resolved = new Map<string, Row>();
  const notFound: string[] = [];
  const ambiguous: { name: string; rows: Row[] }[] = [];

  for (const name of names) {
    const rows = await prisma.contact.findMany({
      where: { ownerId: owner.id, removedAt: null, fullName: { equals: name, mode: "insensitive" } },
      select,
    });
    if (rows.length === 0) {
      notFound.push(name);
      continue;
    }
    if (rows.length > 1) {
      // Never guess which person was meant — a wrong pick messages a stranger.
      ambiguous.push({ name, rows });
      continue;
    }
    resolved.set(rows[0].id, rows[0]);
  }

  if (ids.length > 0) {
    const rows = await prisma.contact.findMany({
      where: { ownerId: owner.id, removedAt: null, id: { in: ids } },
      select,
    });
    for (const r of rows) resolved.set(r.id, r);
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    for (const id of missing) notFound.push(`id=${id}`);
  }

  if (resolved.size > 0) {
    console.log(`Resolved ${resolved.size} contact(s) — CHECK THESE ARE THE RIGHT PEOPLE:`);
    for (const r of resolved.values()) console.log(describe(r));
    console.log("");
  }

  // Unmatched input is reported loudly and never skipped silently: a name that
  // resolved to nobody means the run covers fewer people than you asked for.
  if (notFound.length > 0) {
    console.log(`NOT FOUND (${notFound.length}) — these were NOT marked:`);
    for (const n of notFound) console.log(`  ${n}`);
    console.log("  Check spelling, or use --list to see what is already marked.\n");
  }

  if (ambiguous.length > 0) {
    console.log(`AMBIGUOUS (${ambiguous.length}) — more than one contact shares the name, so none was marked:`);
    for (const a of ambiguous) {
      console.log(`  "${a.name}":`);
      for (const r of a.rows) console.log(describe(r));
    }
    console.log("  Re-run with --ids= for the one you meant.\n");
  }

  if (resolved.size === 0) {
    console.log("Nothing resolved. Nothing to write.\n");
    return;
  }

  if (!write) {
    console.log(`Dry run complete. Re-run with --write to set radarInclude = ${JSON.stringify(target)}.\n`);
    return;
  }

  const res = await prisma.contact.updateMany({
    where: { id: { in: [...resolved.keys()] } },
    data: { radarInclude: target },
  });
  console.log(`Updated ${res.count} contact(s).`);
  console.log("Next: add their employers on /routine/tech-radar, then trigger a scan.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
