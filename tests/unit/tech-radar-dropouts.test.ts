/**
 * Task 7: the run keeps its REJECTS.
 *
 * Today `upsertTechItem` runs on survivors only, so an item that fails a floor leaves
 * no trace at all. That is why the spec's own note (part 3, "הנפילות נשמרות") says no
 * threshold in this system can be calibrated: asking "would 0.55 have let something
 * good through?" has no data to answer from, because the 0.55-0.59 items were never
 * written down. `buildDropoutRows` is the evidence side of that question.
 *
 * Pure — no prisma, no LLM. The caller does the single `createMany`.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  buildDropoutRows,
  DROPOUT_FLOORS,
  DEFAULT_MAX_DROPOUTS_PER_RUN,
  type DropoutFloorResult,
  type DropoutVerdict,
} from "@/lib/tech-radar/dropouts";

const RUN = "run_abc";

function v(url: string, shareworthy: number, stature: number, title?: string): DropoutVerdict {
  return { url, shareworthy, stature, title, kind: "research", publisher: "globes.co.il" };
}
function f(
  url: string,
  floor: string,
  extra: Partial<DropoutFloorResult> = {}
): DropoutFloorResult {
  return { url, pass: false, floor, ...extra };
}

afterEach(() => {
  delete process.env.RADAR_MAX_DROPOUTS_PER_RUN;
});

describe("buildDropoutRows", () => {
  it("records title, url, host, both scores and the floor that rejected it", () => {
    const rows = buildDropoutRows(
      RUN,
      [v("https://www.globes.co.il/news/article-1", 0.55, 0.9, "כותרת")],
      [f("https://www.globes.co.il/news/article-1", "shareworthy", { reason: "0.55 < 0.6" })]
    );
    expect(rows).toEqual([
      {
        runId: RUN,
        contactId: null,
        url: "https://www.globes.co.il/news/article-1",
        host: "www.globes.co.il",
        title: "כותרת",
        shareworthy: 0.55,
        stature: 0.9,
        floor: "shareworthy",
        reason: "0.55 < 0.6",
      },
    ]);
  });

  /** Survivors are already persisted as TechItem/AxisMatch rows. Writing them twice
   *  would make the dropout table a copy of the pool instead of the reject list. */
  it("writes nothing for an item that passed", () => {
    const rows = buildDropoutRows(
      RUN,
      [v("https://a.com/1", 0.9, 0.9)],
      [{ url: "https://a.com/1", pass: true }]
    );
    expect(rows).toEqual([]);
  });

  /**
   * Floor 0 (industry / notOwns / geography) runs BEFORE triage — that is the point of
   * it, no LLM is paid for a Philippine retail-bank feature. Those items have no
   * scores, and null says so. Zero would be indistinguishable from a genuine 0.0
   * verdict, and this table exists to be read as evidence.
   */
  it("leaves the scores null for an item rejected before triage ever scored it", () => {
    const rows = buildDropoutRows(
      RUN,
      [],
      [
        f("https://ph.example.com/bank", "geography", {
          title: "Philippine retail bank launches app",
          reason: "local bank in another country",
        }),
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shareworthy).toBeNull();
    expect(rows[0].stature).toBeNull();
    expect(rows[0].title).toBe("Philippine retail bank launches app");
    expect(rows[0].host).toBe("ph.example.com");
  });

  /** The floors run per person, so the same article legitimately falls twice —
   *  once for Pazit on notOwns, once for Erez on tag overlap. Both are evidence. */
  it("keeps one row per person for the same url", () => {
    const rows = buildDropoutRows(
      RUN,
      [v("https://a.com/1", 0.8, 0.8, "capital markets story")],
      [
        f("https://a.com/1", "not_owns", { contactId: "pazit" }),
        f("https://a.com/1", "tag_overlap", { contactId: "erez" }),
      ]
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.contactId).sort()).toEqual(["erez", "pazit"]);
    expect(rows.map((r) => r.floor).sort()).toEqual(["not_owns", "tag_overlap"]);
  });

  /** The first rejection is the one that matters: a later floor never saw the item. */
  it("collapses the same url and person to its first rejection", () => {
    const rows = buildDropoutRows(
      RUN,
      [v("https://a.com/1", 0.2, 0.2)],
      [
        f("https://a.com/1", "shareworthy", { contactId: "pazit" }),
        f("https://a.com/1", "tag_overlap", { contactId: "pazit" }),
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].floor).toBe("shareworthy");
  });

  it("caps the rows per run so one bad week cannot flood the table", () => {
    const results = Array.from({ length: DEFAULT_MAX_DROPOUTS_PER_RUN + 250 }, (_, i) =>
      f(`https://a.com/${i}`, "tag_overlap")
    );
    const rows = buildDropoutRows(RUN, [], results);
    expect(rows).toHaveLength(DEFAULT_MAX_DROPOUTS_PER_RUN);
  });

  /**
   * A cap that keeps a random slice answers nothing. The rows that decide whether a
   * threshold should move are the ones that only just failed, so the cap keeps the
   * near-misses and discards the obvious rubbish.
   */
  it("keeps the near-misses when it has to drop rows", () => {
    const near = v("https://a.com/near", 0.59, 0.95, "the near miss");
    const rubbish = Array.from({ length: DEFAULT_MAX_DROPOUTS_PER_RUN + 50 }, (_, i) =>
      v(`https://a.com/${i}`, 0.0, 0.0)
    );
    const rows = buildDropoutRows(
      RUN,
      [...rubbish, near],
      [
        ...rubbish.map((r) => f(r.url, "shareworthy")),
        f("https://a.com/near", "shareworthy"),
      ]
    );
    expect(rows).toHaveLength(DEFAULT_MAX_DROPOUTS_PER_RUN);
    expect(rows.map((r) => r.url)).toContain("https://a.com/near");
    expect(rows[0].url).toBe("https://a.com/near");
  });

  it("honours an env override of the cap", () => {
    process.env.RADAR_MAX_DROPOUTS_PER_RUN = "3";
    const rows = buildDropoutRows(
      RUN,
      [],
      Array.from({ length: 20 }, (_, i) => f(`https://a.com/${i}`, "tag_overlap"))
    );
    expect(rows).toHaveLength(3);
  });

  it("ignores a nonsense env override rather than writing nothing", () => {
    process.env.RADAR_MAX_DROPOUTS_PER_RUN = "not a number";
    const rows = buildDropoutRows(RUN, [], [f("https://a.com/1", "tag_overlap")]);
    expect(rows).toHaveLength(1);
  });

  /**
   * Same discipline as `asKind`: an unrecognised floor becomes "unknown" rather than
   * one of the real floors, because a calibration query that reads a mislabelled floor
   * draws the wrong conclusion with full confidence. The raw label survives in
   * `reason` so nothing is actually lost.
   */
  it("does not map an unrecognised floor onto a real one", () => {
    const rows = buildDropoutRows(RUN, [], [f("https://a.com/1", "share-worthiness!!")]);
    expect(rows[0].floor).toBe("unknown");
    expect(rows[0].reason).toContain("share-worthiness!!");
    expect(DROPOUT_FLOORS).toContain("unknown");
  });

  it("accepts a floor label whatever its casing or padding", () => {
    const rows = buildDropoutRows(RUN, [], [f("https://a.com/1", "  Tag_Overlap ")]);
    expect(rows[0].floor).toBe("tag_overlap");
  });

  it("records a rejection with no floor named as unknown, never as a pass", () => {
    const rows = buildDropoutRows(RUN, [], [{ url: "https://a.com/1", pass: false }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].floor).toBe("unknown");
  });

  /** A row whose title is a mystery is a row nobody can read. The url is the worst
   *  acceptable fallback; an empty string is not one. */
  it("falls back to the url when no title reached it", () => {
    const rows = buildDropoutRows(RUN, [v("https://a.com/1", 0.1, 0.1)], [f("https://a.com/1", "stature")]);
    expect(rows[0].title).toBe("https://a.com/1");
  });

  it("prefers the floor's own title over the verdict's", () => {
    const rows = buildDropoutRows(
      RUN,
      [v("https://a.com/1", 0.1, 0.1, "from verdict")],
      [f("https://a.com/1", "stature", { title: "from floor" })]
    );
    expect(rows[0].title).toBe("from floor");
  });

  it("drops a result with no usable url instead of writing a hostless row", () => {
    const rows = buildDropoutRows(RUN, [], [f("   ", "tag_overlap"), f("https://a.com/1", "stature")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://a.com/1");
  });

  it("returns nothing for a run that rejected nothing", () => {
    expect(buildDropoutRows(RUN, [], [])).toEqual([]);
  });
});
