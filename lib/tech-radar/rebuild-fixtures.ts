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

/**
 * One layer-4 field of work, the way `radar-rebuild-people.ts` reads it back off
 * PersonProfile.domains. Only `kind` and `source` are load-bearing for the fixtures
 * below — `evidence` is not needed to judge whether the RIGHT domain came out.
 */
export type ProposedDomain = {
  domain: string;
  kind: "found" | "derived";
  source?: string | null;
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
  /**
   * When true, the pattern is judged against this person's FOUND domains
   * (PersonProfile.domains, kind === "found") instead of the axes. A domain with no
   * matching found entry — including because the whole list came back "derived" —
   * fails this check exactly like a missing axis fails a `subject_present` one: same
   * verdict, same "expected subject not found" reading.
   */
  domainsOnly?: boolean;
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
      {
        name: "full title parsed as FOUND domains",
        kind: "subject_present",
        describe:
          "\"Chief Information & Technology Officer\" הוא שני תפקידים, לא אחד — מידע/IT " +
          "וטכנולוגיה צריכים לצאת כשדות found מהתואר עצמו, לא רק כ-derived מהחיתוך תפקיד×חברה",
        domainsOnly: true,
        pattern: /information|טכנולוגיה|technology|IT\b|מידע/i,
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

/**
 * Judge one person's proposed axes (and, optionally, their FOUND domains). Empty checks
 * = nobody has fixtures for this slug. `domains` defaults to empty — callers that only
 * have axes in hand (the preview path, before any domain has been parsed) still get
 * every axis-based check; only a `domainsOnly` check can ever be affected by the
 * default, and it fails exactly the way a missing subject should.
 */
export function runFixtures(slug: string, axes: ProposedAxis[], domains: ProposedDomain[] = []): FixtureResult {
  const fixture = FIXTURES.find((f) => slug.toLowerCase().includes(f.slug));
  if (!fixture) return { slug, person: slug, checks: [] };

  const foundDomains = domains.filter((d) => d.kind === "found");

  const checks: CheckResult[] = fixture.checks.map((c) => {
    const matched = c.domainsOnly
      ? foundDomains.filter((d) => c.pattern.test(d.domain)).map((d) => d.domain)
      : axes.filter((a) => c.pattern.test(hay(a))).map((a) => a.label);
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
