/**
 * The 2026-08-26 acceptance fixtures, from the first sent draft's feedback session.
 *
 * These check the OUTPUT of the brain's free staged thinking — they are not templates
 * the builder aims at. If the thinking does not reach them on its own, the fix is the
 * prompt, never a hardcoded category.
 *
 * DoD for the brain upgrade: all four pass after `scripts/radar-rebuild-people.ts`.
 *
 *   node_modules/.bin/tsx scripts/radar-verify-rebuild.ts --owner=<userId>
 *
 * Read-only. Exit 1 on any failure, with the live axes printed so the miss is
 * arguable rather than a bare boolean.
 */
import { prisma } from "@/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

type LiveAxis = { label: string; rationale: string; queries: string[] };

/** One searchable haystack per axis: label + rationale + its queries. */
function hay(a: LiveAxis): string {
  return `${a.label} ${a.rationale} ${a.queries.join(" ")}`;
}

type Check = { name: string; ok: (axes: LiveAxis[]) => boolean; describe: string };

/** slug (of linkedinUrl) -> the feedback-derived expectations. */
const FIXTURES: { slug: string; person: string; checks: Check[] }[] = [
  {
    slug: "elinor-levinson-gafni",
    person: "Elinor Levinson Gafni — VP Product & Digital (Retail Banking), Leumi",
    checks: [
      {
        name: "no core-systems axis",
        describe: "מערכות ליבה הן הנושא של ה-CIO, לא של VP Product",
        ok: (axes) => !axes.some((a) => /מערכות ליבה|core banking|core systems|מודרניזציה של מערכות/i.test(hay(a))),
      },
      {
        name: "competitor-products-in-retail axis",
        describe: "מוצרי מתחרים בריטייל הבנקאי — מה שלוחץ על מי שמחזיקה את המוצר",
        ok: (axes) => axes.some((a) => /מתחר|competitor|הפועלים|דיסקונט|מזרחי/i.test(hay(a))),
      },
    ],
  },
  {
    slug: "gil--tamir",
    person: "Gil Tamir — Deputy CEO & Director of Innovation and Technology, Phoenix",
    checks: [
      {
        name: "insurtech-to-catch axis",
        describe: "Lemonade / insurtech שצריך להדביק — הדיסראפטור של הענף שלו",
        ok: (axes) => axes.some((a) => /lemonade|insurtech|אינשורטק|וויביט|wefox/i.test(hay(a))),
      },
    ],
  },
  {
    slug: "erezrachmil",
    person: "Erez Rachmil — CITO, Bank Hapoalim",
    checks: [
      {
        name: "technical axes survive",
        describe: "הצירים הטכניים נשארים — הוא באמת ה-CITO",
        ok: (axes) => axes.some((a) => /ענן|cloud|API|תשתי|ליבה|core/i.test(hay(a))),
      },
      {
        name: "B2C-adoption axis",
        describe: "מוצרי B2C מענפים אחרים שאפשר לאמץ בבנקאות",
        ok: (axes) => axes.some((a) => /B2C|צרכן|ענפים אחרים|לאמץ|אימוץ/i.test(hay(a))),
      },
      {
        name: "cyber × banking axis",
        describe: "סייבר בהצטלבות עם בנקאות",
        ok: (axes) => axes.some((a) => /סייבר|cyber|אבטח/i.test(hay(a))),
      },
    ],
  },
  {
    slug: "pazit-garfinkel",
    person: "Pazit Garfinkel — Head of Retail Banking, Bank Hapoalim",
    checks: [
      {
        name: "global retail-banking consumer innovations axis",
        describe: "חידושים עולמיים בבנקאות קמעונאית: הלוואות, חיסכון, השקעות לצרכן",
        ok: (axes) =>
          axes.some(
            (a) => /קמעונ|ריטייל|retail/i.test(hay(a)) || /הלוואות|חיסכון|השקעות לצרכן|consumer lending|consumer banking/i.test(hay(a))
          ),
      },
    ],
  },
];

async function main() {
  const ownerId = arg("owner");
  if (!ownerId) {
    console.error("Usage: --owner=<userId>");
    process.exit(1);
  }

  let failures = 0;

  for (const fixture of FIXTURES) {
    const contact = await prisma.contact.findFirst({
      where: { ownerId, removedAt: null, linkedinUrl: { contains: fixture.slug, mode: "insensitive" } },
      select: {
        fullName: true,
        personProfile: {
          select: {
            reasoning: true,
            axes: {
              where: { mutedAt: null },
              select: { rationale: true, axis: { select: { label: true, searchQueries: true } } },
            },
          },
        },
      },
    });

    console.log(`\n═══ ${fixture.person}`);
    if (!contact?.personProfile) {
      console.log("  FAIL — no PersonProfile at all");
      failures += fixture.checks.length;
      continue;
    }

    const axes: LiveAxis[] = contact.personProfile.axes.map((pa) => ({
      label: pa.axis.label,
      rationale: pa.rationale,
      queries: pa.axis.searchQueries,
    }));
    for (const a of axes) console.log(`  · ${a.label}`);
    if (contact.personProfile.reasoning) {
      console.log(`  reasoning: ${contact.personProfile.reasoning.slice(0, 300)}`);
    } else {
      console.log("  (no reasoning saved — old-brain profile?)");
    }

    for (const check of fixture.checks) {
      const ok = check.ok(axes);
      console.log(`  ${ok ? "PASS" : "FAIL"} — ${check.name} (${check.describe})`);
      if (!ok) failures += 1;
    }
  }

  console.log(failures === 0 ? "\nALL FIXTURES PASS\n" : `\n${failures} CHECK(S) FAILED — fix the PROMPT, not the fixtures.\n`);
  if (failures > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
