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

/**
 * Acceptance tests for Relationship Radar v2, built from the three defects the first
 * production run exposed on 2026-08-20.
 *
 * Criterion (ג) runs today — the archetype swap has shipped. Criteria (א) and (ב)
 * are `it.skip` because the code they test does not exist yet; each names the module
 * Plans 2-4 must create, and the plan task's definition of done is "delete the .skip
 * and this passes unchanged". Do not soften an assertion to make it pass.
 */

/**
 * The modules for (א) and (ב) do not exist yet. Vite resolves even a dynamic import
 * with a literal specifier at transform time, which would fail the whole suite rather
 * than skip these tests — so the path stays opaque until the test body runs.
 *
 * When the plan lands: replace the `futureModule(...)` call with a static import at
 * the top of the file and delete the `.skip`.
 */
const futureModule = (path: string) => import(/* @vite-ignore */ path);

// ---------------------------------------------------------------------------
// (א) The inverted filter — Plan 2/3, lib/tech-radar/triage.ts
// ---------------------------------------------------------------------------

/**
 * The v1 triage asked "is this a launch?" and this item is the purest possible yes:
 * AWS announcing an AWS feature on the AWS blog. The inverted filter asks a different
 * question, and must answer it low.
 */
describe("(א) inverted triage: a vendor launch is not shareworthy on its own", () => {
  const SHAREWORTHY_FLOOR = 0.6;

  /** triageAll takes PoolItem — {title, url, snippet, publishedAt} — not the item record. */
  const poolItem = (over: Record<string, unknown> = {}) => ({
    title: VENDOR_LAUNCH_ITEM.title,
    url: VENDOR_LAUNCH_ITEM.url,
    snippet: VENDOR_LAUNCH_ITEM.summary,
    publishedAt: VENDOR_LAUNCH_ITEM.publishedAt,
    ...over,
  });

  it.skip("scores a pure cloud-vendor capability launch below the floor", async () => {
    const { triageAll } = await futureModule("@/lib/tech-radar/triage");
    const [verdict] = await triageAll([poolItem()]);

    expect(verdict.shareworthy).toBeLessThan(SHAREWORTHY_FLOOR);
    // `kind` has to name what it is, so the discard is auditable and the per-kind
    // floor in the learning loop has something to move.
    expect(verdict.kind).toBe("vendor_launch");
  });

  it.skip("scores the same capability high when a third party analyses the trend", async () => {
    const { triageAll } = await futureModule("@/lib/tech-radar/triage");
    const [verdict] = await triageAll([
      poolItem({
        title: "מחקר: 60% מצוותי הדאטה זנחו מסדי וקטורים נפרדים ב-2026",
        url: "https://state-of-data-report.org/2026/vector-consolidation",
      }),
    ]);

    expect(verdict.shareworthy).toBeGreaterThanOrEqual(SHAREWORTHY_FLOOR);
    expect(verdict.kind).toBe("research");
  });

  /**
   * The distinction is publisher-and-angle, not topic. If the filter simply
   * downranked "vector search", both of the above would fail together and the test
   * would still be green on the wrong reason.
   */
  it.skip("separates the two by angle rather than by subject matter", async () => {
    const { triageAll } = await futureModule("@/lib/tech-radar/triage");
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
  });
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
  it.skip("passes at most one of three colleagues, each judged on person context", async () => {
    const { judgeWhyHim } = await futureModule("@/lib/tech-radar/veto");

    const verdicts = [];
    for (const person of THREE_FOUNDERS_ONE_COMPANY) {
      verdicts.push(
        await judgeWhyHim({
          contact: person,
          company: COMPANY_365SCORES,
          item: VENDOR_LAUNCH_ITEM,
          axisRationale: SHARED_COMPANY_RATIONALE,
        })
      );
    }

    const passed = verdicts.filter((v) => v.specific);
    expect(passed.length).toBeLessThanOrEqual(1);
  });

  /**
   * The load-bearing half. A veto that rejects all three for the wrong reason
   * (e.g. it rejects everything) would satisfy the count above. What must be true is
   * that a rationale describing only the COMPANY is recognised as not person-specific.
   */
  it.skip("rejects a company-level rationale as not person-specific", async () => {
    const { judgeWhyHim } = await futureModule("@/lib/tech-radar/veto");
    const verdict = await judgeWhyHim({
      contact: THREE_FOUNDERS_ONE_COMPANY[1], // the COO
      company: COMPANY_365SCORES,
      item: VENDOR_LAUNCH_ITEM,
      axisRationale: SHARED_COMPANY_RATIONALE,
    });

    expect(verdict.specific).toBe(false);
    expect(verdict.whyHim).toMatch(/company|חברה/i);
  });

  /** A veto does not walk down the list until something passes. */
  it.skip("does not promote a colleague after vetoing the first candidate", async () => {
    const { selectRecipientsForItem } = await futureModule("@/lib/tech-radar/veto");
    const chosen = await selectRecipientsForItem({
      item: VENDOR_LAUNCH_ITEM,
      candidates: THREE_FOUNDERS_ONE_COMPANY.map((c) => ({
        ...c,
        company: COMPANY_365SCORES,
        axisRationale: SHARED_COMPANY_RATIONALE,
      })),
    });
    expect(chosen.length).toBeLessThanOrEqual(1);
  });
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
