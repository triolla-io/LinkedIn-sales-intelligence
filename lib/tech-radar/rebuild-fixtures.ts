/**
 * The 2026-08-26 acceptance fixtures, from the feedback on the first message the system
 * ever sent (Pazit Garfinkel / the Leumi bitcoin item).
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN. These are keyword checks over an axis's label,
 * rationale and queries. They cut both ways:
 *   - "חידוש התשתית הבנקאית" passes the no-core-systems check and is the same CTO-lens
 *     mistake in different words.
 *   - "כלל ביטוח דיגיטלי" fails the insurtech check and may well be the right axis.
 *
 * So there is no PASS here. A clean check reports "לא נמצאה הטעות הידועה" — the known
 * mistake was not found. That is a smoke test, and it does not replace a human reading
 * the axes against what Yuval actually said.
 *
 * Pure: no prisma, no LLM. Runs against axes proposed in memory (preview) or axes read
 * from the database (post-rebuild verification), so both paths judge identically.
 */

export type ProposedAxis = {
  label: string;
  rationale: string;
  queries: string[];
};

/** One haystack per axis. The brain may name a competitor in a QUERY, not the label. */
function hay(a: ProposedAxis): string {
  return `${a.label} ${a.rationale} ${a.queries.join(" ")}`;
}

/**
 * A check is either "this known mistake must be absent" or "this expected subject must
 * be present". The two failures read differently and must not be collapsed: losing the
 * wrong axis is not the same achievement as gaining the right one.
 */
type CheckKind = "mistake_absent" | "subject_present";

type FixtureCheck = {
  name: string;
  kind: CheckKind;
  /** What the feedback actually said, in the reviewer's words. */
  describe: string;
  pattern: RegExp;
};

export type CheckResult = {
  name: string;
  kind: CheckKind;
  describe: string;
  clean: boolean;
  verdict: string;
  /** The axes that matched, so a human can judge the match rather than trust it. */
  matched: string[];
};

export type FixtureResult = {
  slug: string;
  person: string;
  checks: CheckResult[];
};

export const FIXTURES: { slug: string; person: string; checks: FixtureCheck[] }[] = [
  {
    slug: "elinor-levinson-gafni",
    person: "Elinor Levinson Gafni — VP Product & Digital (Retail Banking), Bank Leumi",
    checks: [
      {
        name: "no core-systems axis",
        kind: "mistake_absent",
        describe: "מערכות ליבה הן הנושא של ה-CIO, לא של VP Product",
        pattern: /מערכות ליבה|מערכות הליבה|core banking|core systems|מודרניזציה של מערכות/i,
      },
      {
        name: "competitor-products-in-retail axis",
        kind: "subject_present",
        describe: "מוצרי מתחרים בריטייל הבנקאי — מה שלוחץ על מי שמחזיקה את המוצר",
        // Widened after a false negative: "תחרות" does not contain "מתחר", and the
        // brain writes rivals in Latin ("Poalim Digital") as readily as in Hebrew.
        pattern: /תחר|מתחר|competit|rival|הפועלים|poalim|דיסקונט|discount|מזרחי|mizrahi|pepper|one zero|וואן זירו/i,
      },
    ],
  },
  {
    slug: "gil--tamir",
    person: "Gil Tamir — Deputy CEO & Director of Innovation and Technology, Phoenix",
    checks: [
      {
        name: "insurtech-to-catch axis",
        kind: "subject_present",
        describe: "Lemonade / insurtech שצריך להדביק — הדיסראפטור של הענף שלו",
        pattern: /lemonade|insurtech|אינשורטק|wefox|root insurance|ביטוח דיגיטלי/i,
      },
    ],
  },
  {
    slug: "erezrachmil",
    person: "Erez Rachmil — Chief Information & Technology Officer, Bank Hapoalim",
    checks: [
      {
        name: "technical axes survive",
        kind: "subject_present",
        describe: "הצירים הטכניים נשארים — הוא באמת ה-CITO",
        pattern: /ענן|cloud|API|תשתי|ליבה|core|נתונים|data/i,
      },
      {
        name: "B2C-from-other-industries axis",
        kind: "subject_present",
        describe: "מוצרי B2C מענפים אחרים שאפשר לאמץ בבנקאות",
        pattern: /B2C|צרכן|ענפים אחרים|לאמץ|אימוץ|קמעונ/i,
      },
      {
        name: "cyber × banking axis",
        kind: "subject_present",
        describe: "סייבר בהצטלבות עם בנקאות",
        pattern: /סייבר|cyber|אבטח/i,
      },
    ],
  },
  {
    slug: "pazit-garfinkel",
    person: "Pazit Garfinkel — Head of Retail Banking, Bank Hapoalim",
    checks: [
      {
        name: "global consumer retail-banking innovations axis",
        kind: "subject_present",
        describe: "חידושים עולמיים בבנקאות קמעונאית לצרכן: הלוואות, חיסכון, השקעות — הזדמנות לאמץ, לא איום",
        // Narrowed after a false positive: an axis about Israeli rivals attacking her
        // segment matched on "קמעונ" and was reported clean. Yuval asked for the other
        // appetite — what consumer lending/savings/investing look like ELSEWHERE — so the
        // product itself, or an adoption/global framing, has to appear.
        pattern: /הלוואות|חיסכון|השקעות|consumer lending|consumer savings|consumer investing|בעולם|עולמי|גלובלי|לאמץ|אימוץ|ענפים אחרים|abroad|global/i,
      },
    ],
  },
];

const VERDICT = {
  clean_mistake: "לא נמצאה הטעות הידועה",
  found_mistake: "הטעות הידועה נמצאה",
  clean_subject: "לא נמצאה הטעות הידועה",
  missing_subject: "הציר המצופה לא נמצא",
} as const;

/** Judge one person's proposed axes. Empty checks = nobody has fixtures for this slug. */
export function runFixtures(slug: string, axes: ProposedAxis[]): FixtureResult {
  const fixture = FIXTURES.find((f) => slug.toLowerCase().includes(f.slug));
  if (!fixture) return { slug, person: slug, checks: [] };

  const checks: CheckResult[] = fixture.checks.map((c) => {
    const matched = axes.filter((a) => c.pattern.test(hay(a))).map((a) => a.label);
    const present = matched.length > 0;
    const clean = c.kind === "mistake_absent" ? !present : present;
    const verdict =
      c.kind === "mistake_absent"
        ? clean
          ? VERDICT.clean_mistake
          : VERDICT.found_mistake
        : clean
          ? VERDICT.clean_subject
          : VERDICT.missing_subject;
    return { name: c.name, kind: c.kind, describe: c.describe, clean, verdict, matched };
  });

  return { slug, person: fixture.person, checks };
}
