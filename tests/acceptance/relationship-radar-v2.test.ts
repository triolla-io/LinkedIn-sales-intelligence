import { describe, it, expect } from "vitest";
import {
  VENDOR_LAUNCH_ITEM,
  SHARED_COMPANY_RATIONALE,
  THREE_FOUNDERS_ONE_COMPANY,
  COMPANY_365SCORES,
  V1_DRAFTS,
  V2_TARGET_DRAFT,
} from "@/tests/fixtures/relationship-radar-v2";
import { checkDraft } from "@/lib/tech-radar/draft-guard";
import { DRAFT_SYSTEM } from "@/lib/tech-radar/draft";
import { triageAll } from "@/lib/tech-radar/triage";
import { judgeWhyHim, selectRecipientsForItem } from "@/lib/tech-radar/veto";
import { SHAREWORTHY_FLOOR } from "@/lib/tech-radar/types";

/**
 * (א) and (ב) call real models — the veto runs on Opus and routinely exceeds vitest's
 * 5s default. Declared here rather than passed as --testTimeout on the command line, so
 * a plain `npm test` does not fail for whoever runs it next.
 */
const LLM_TIMEOUT = 120_000;

/**
 * Acceptance tests for Relationship Radar v2, built from the three defects the first
 * production run exposed on 2026-08-20.
 *
 * All three criteria run. Nothing here is skipped, and no assertion was softened to
 * get there: (ג) the archetype, (א) the inverted triage, (ב) the per-person veto.
 * (א) and (ב) call real models, so they are slower than a unit test by design — they
 * are testing a prompt's judgement, which is the thing that can regress silently.
 */

// ---------------------------------------------------------------------------
// (א) The inverted filter — Plan 2/3, lib/tech-radar/triage.ts
// ---------------------------------------------------------------------------

/**
 * The v1 triage asked "is this a launch?" and this item is the purest possible yes:
 * AWS announcing an AWS feature on the AWS blog. The inverted filter asks a different
 * question, and must answer it low.
 */
describe("(א) inverted triage: a vendor launch is not shareworthy on its own", () => {
  /** triageAll takes PoolItem — {title, url, snippet, publishedAt} — not the item record. */
  const poolItem = (over: Record<string, unknown> = {}) => ({
    title: VENDOR_LAUNCH_ITEM.title,
    url: VENDOR_LAUNCH_ITEM.url,
    snippet: VENDOR_LAUNCH_ITEM.summary,
    publishedAt: VENDOR_LAUNCH_ITEM.publishedAt,
    ...over,
  });

  it("scores a pure cloud-vendor capability launch below the floor", async () => {
    const [verdict] = await triageAll([poolItem()]);

    expect(verdict.shareworthy).toBeLessThan(SHAREWORTHY_FLOOR);
    // `kind` has to name what it is, so the discard is auditable and the per-kind
    // floor in the learning loop has something to move.
    expect(verdict.kind).toBe("vendor_launch");
  }, LLM_TIMEOUT);

  it("scores the same capability high when a third party analyses the trend", async () => {
    const [verdict] = await triageAll([
      poolItem({
        title: "מחקר: 60% מצוותי הדאטה זנחו מסדי וקטורים נפרדים ב-2026",
        url: "https://state-of-data-report.org/2026/vector-consolidation",
      }),
    ]);

    expect(verdict.shareworthy).toBeGreaterThanOrEqual(SHAREWORTHY_FLOOR);
    expect(verdict.kind).toBe("research");
  }, LLM_TIMEOUT);

  /**
   * The distinction is publisher-and-angle, not topic. If the filter simply
   * downranked "vector search", both of the above would fail together and the test
   * would still be green on the wrong reason.
   */
  it("separates the two by angle rather than by subject matter", async () => {
    const [launch, research] = await Promise.all([
      triageAll([poolItem()]),
      triageAll([
        poolItem({
          title: "מחקר: איך צוותי דאטה בוחרים מסד וקטורי",
          url: "https://state-of-data-report.org/2026/how-teams-choose",
        }),
      ]),
    ]);
    expect(research[0].shareworthy - launch[0].shareworthy).toBeGreaterThan(0.25);
  }, LLM_TIMEOUT);
});

// ---------------------------------------------------------------------------
// (ב) The veto — Plan 4, lib/tech-radar/veto.ts
// ---------------------------------------------------------------------------

/**
 * The mailing-list scenario, verbatim from production: one item, one company, three
 * founders, and one `fitRationale` shared by all three. A per-person veto that passes
 * more than one of them has not been given anything person-specific to judge.
 *
 * The binding rule is `MAX_RECIPIENTS_PER_ITEM_PER_COMPANY = 1` over the item's
 * lifetime — stricter than, and evaluated before, the spec's `MAX_RECIPIENTS_PER_ITEM
 * = 3`, which counts across companies. See the spec's "Per-person ranking, then veto".
 */
describe("(ב) veto: one item, one company, at most one recipient", () => {
  it("passes at most one of three colleagues, each judged on person context", async () => {
    const verdicts = [];
    for (const person of THREE_FOUNDERS_ONE_COMPANY) {
      verdicts.push(
        await judgeWhyHim({
          contact: { contactId: person.contactId, fullName: person.fullName, currentTitle: person.currentTitle },
          company: { trackedCompanyId: COMPANY_365SCORES.trackedCompanyId, name: COMPANY_365SCORES.name },
          item: { technology: VENDOR_LAUNCH_ITEM.technology, title: VENDOR_LAUNCH_ITEM.title, summary: VENDOR_LAUNCH_ITEM.summary, kind: "vendor_launch", publisher: VENDOR_LAUNCH_ITEM.publisher },
          axisRationale: SHARED_COMPANY_RATIONALE,
        })
      );
    }

    const passed = verdicts.filter((v) => v.specific);
    expect(passed.length).toBeLessThanOrEqual(1);
  }, LLM_TIMEOUT);

  /**
   * The load-bearing half. A veto that rejects all three for the wrong reason
   * (e.g. it rejects everything) would satisfy the count above. What must be true is
   * that a rationale describing only the COMPANY is recognised as not person-specific.
   */
  it("rejects a company-level rationale as not person-specific", async () => {
    const coo = THREE_FOUNDERS_ONE_COMPANY[1];
    const verdict = await judgeWhyHim({
      contact: { contactId: coo.contactId, fullName: coo.fullName, currentTitle: coo.currentTitle },
      company: { trackedCompanyId: COMPANY_365SCORES.trackedCompanyId, name: COMPANY_365SCORES.name },
      item: { technology: VENDOR_LAUNCH_ITEM.technology, title: VENDOR_LAUNCH_ITEM.title, summary: VENDOR_LAUNCH_ITEM.summary, kind: "vendor_launch", publisher: VENDOR_LAUNCH_ITEM.publisher },
      // The rationale that was byte-identical for the CEO, the COO and the VP-R&D.
      axisRationale: SHARED_COMPANY_RATIONALE,
    });

    // The reason must be recorded even on rejection, so a discard is explicable.
    expect(verdict.specific).toBe(false);
    expect(verdict.whyHim.trim().length).toBeGreaterThan(0);
  }, LLM_TIMEOUT);

  /** A veto does not walk down the list until something passes. */
  /**
   * The discriminating half, and the reason the other (ב) tests are not enough: a veto
   * that rejects EVERYTHING satisfies every count assertion above while being useless.
   * A rationale naming something this person actually owns must get through.
   */
  it("accepts a rationale that names something the person actually owns", async () => {
    const roy = THREE_FOUNDERS_ONE_COMPANY[2]; // Co-Founder & VP-R&D
    const verdict = await judgeWhyHim({
      contact: {
        contactId: roy.contactId,
        fullName: roy.fullName,
        currentTitle: roy.currentTitle,
        roleLens: "בונה ומתחזק את מנוע ההמלצות והדירוג — הוא כתב את הגרסה הראשונה שלו",
        personalNotes: "החליף את מסד הווקטורים שלהם לפני חצי שנה והתלונן על העלות",
      },
      company: { trackedCompanyId: COMPANY_365SCORES.trackedCompanyId, name: COMPANY_365SCORES.name },
      item: {
        technology: VENDOR_LAUNCH_ITEM.technology,
        title: VENDOR_LAUNCH_ITEM.title,
        summary: VENDOR_LAUNCH_ITEM.summary,
        kind: "research",
        publisher: "state-of-data-report.org",
      },
      axisRationale: "הוא זה שהחליף את מסד הווקטורים ושילם על זה, ולכן קונסולידציה של וקטורים לתוך המסד התפעולי נוגעת בהחלטה שהוא עצמו קיבל",
      axisLabel: "קונסולידציה של מסדי וקטורים",
    });

    expect(verdict.specific).toBe(true);
    expect(verdict.whyHim.trim().length).toBeGreaterThan(0);
  }, LLM_TIMEOUT);

  it("does not promote a colleague after vetoing the first candidate", async () => {
    const chosen = await selectRecipientsForItem({
      item: { technology: VENDOR_LAUNCH_ITEM.technology, title: VENDOR_LAUNCH_ITEM.title, summary: VENDOR_LAUNCH_ITEM.summary, kind: "vendor_launch", publisher: VENDOR_LAUNCH_ITEM.publisher },
      candidates: THREE_FOUNDERS_ONE_COMPANY.map((c) => ({
        contact: { contactId: c.contactId, fullName: c.fullName, currentTitle: c.currentTitle },
        company: { trackedCompanyId: COMPANY_365SCORES.trackedCompanyId, name: COMPANY_365SCORES.name },
        axisRationale: SHARED_COMPANY_RATIONALE,
      })),
    });
    expect(chosen.filter((d) => d.passed).length).toBeLessThanOrEqual(1);
  }, LLM_TIMEOUT);
});

// ---------------------------------------------------------------------------
// (ג) The archetype — SHIPPED 2026-08-20 (f7c20e3). These run.
// ---------------------------------------------------------------------------

describe("(ג) archetype: no draft suggests adopting anything", () => {
  it("flags the v1 adoption suggestion in every draft the run produced", () => {
    for (const draft of V1_DRAFTS) {
      expect(checkDraft(draft), draft.slice(0, 60)).toContain("adoption_suggestion");
    }
  });

  it("passes the v2 target draft clean", () => {
    expect(checkDraft(V2_TARGET_DRAFT)).toEqual([]);
  });

  it("bans the phrase in the prompt itself, not only in the output", () => {
    // Named as forbidden wording — present, but never as an instruction to use it.
    expect(DRAFT_SYSTEM).toMatch(/NO SUGGESTION/);
    expect(DRAFT_SYSTEM).not.toMatch(/must use the wording "אולי תוכלו לשלב/);
  });

  /** Defect (4). The prompt never asked for either of these; only a check catches them. */
  it("catches the Hebrew garbling the run produced", () => {
    const doubled = V1_DRAFTS.filter((d) => checkDraft(d).includes("duplicate_possessive"));
    expect(doubled.length).toBeGreaterThanOrEqual(2);

    const glued = V1_DRAFTS.filter((d) => checkDraft(d).includes("glued_script"));
    // "שProtoPie", "לprototyping", "וhandoff" — all in one draft.
    expect(glued.length).toBeGreaterThanOrEqual(1);
  });

  it("does not fire on correct Hebrew-Latin punctuation", () => {
    expect(checkDraft("היי דנה, נתקלתי במשהו על MCP ועל ב-DynamoDB.\nhttps://a.com")).toEqual([]);
  });

  it("catches an ask and a self-pitch", () => {
    expect(checkDraft("היי דנה, ראיתי משהו. מה דעתך?")).toContain("ask");
    expect(checkDraft("היי דנה, אנחנו יכולים להטמיע את זה אצלכם.")).toContain("self_pitch");
  });
});
