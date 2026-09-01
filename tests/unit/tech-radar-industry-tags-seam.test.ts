import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The seam the closed taxonomy actually broke on, measured in production 2026-09-01:
 * a live person-scan wrote 11 TechItem rows and NOT ONE of them carried an industryTag.
 *
 * Every unit around the seam was green while that happened, because each one was tested
 * against a hand-written stand-in for its neighbour:
 *
 *   - tech-radar-source-packs.test.ts     resolves packs from FAKE prisma rows
 *   - tech-radar-triage-tags.test.ts      parses a hand-written model response
 *   - tech-radar-flow-v3.test.ts          mocks triageAll and hands it a FAKE pack
 *
 * So nothing ever asked the one question the production run answers with a no: does a
 * taxonomy the SCAN resolves reach the real triage prompt, and do the tags that come back
 * land on the row that gets written? This file asks exactly that, end to end, with only
 * the outside world mocked — prisma, the fetchers, the page reader and openrouterChat.
 * `triage.ts` and `source-packs.ts` are the REAL modules here; that is the point.
 *
 * NO network and NO LLM call: openrouterChat is mocked, and it is the only paid path left
 * unmocked in the chain under test.
 */

// ─── prisma ──────────────────────────────────────────────────────────────────
const axisFindMany = vi.fn();
const profileFindMany = vi.fn();
const scanRunCreate = vi.fn();
const scanRunUpdate = vi.fn();
const scanRunFindUnique = vi.fn();
const axisMatchUpsert = vi.fn();
const techItemUpdate = vi.fn();
const dropoutCreateMany = vi.fn();
const sourcePackFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    radarAxis: { findMany: (...a: unknown[]) => axisFindMany(...a) },
    personProfile: { findMany: (...a: unknown[]) => profileFindMany(...a) },
    radarScanRun: {
      create: (...a: unknown[]) => scanRunCreate(...a),
      update: (...a: unknown[]) => scanRunUpdate(...a),
      findUnique: (...a: unknown[]) => scanRunFindUnique(...a),
    },
    axisMatch: { upsert: (...a: unknown[]) => axisMatchUpsert(...a) },
    techItem: { update: (...a: unknown[]) => techItemUpdate(...a) },
    radarDropout: { createMany: (...a: unknown[]) => dropoutCreateMany(...a) },
    radarSourcePack: { findMany: (...a: unknown[]) => sourcePackFindMany(...a) },
  },
}));

// ─── the outside world ───────────────────────────────────────────────────────
const chat = vi.fn();
vi.mock("@/lib/openrouter/client", () => ({ openrouterChat: (...a: unknown[]) => chat(...a) }));

const fetchSourcePack = vi.fn();
vi.mock("@/lib/tech-radar/fetch-sources", async () => {
  const actual = await import("@/lib/tech-radar/fetch-sources");
  return { ...actual, fetchSourcePack: (...a: unknown[]) => fetchSourcePack(...a) };
});

const fetchPoolNews = vi.fn();
vi.mock("@/lib/tech-radar/fetch-pool-news", () => ({
  fetchPoolNews: (...a: unknown[]) => fetchPoolNews(...a),
  SCAN_WINDOW_DAYS: 30,
}));

const readPage = vi.fn();
vi.mock("@/lib/research/read-page", () => ({
  readPage: (...a: unknown[]) => readPage(...a),
  readPages: async () => [],
  MAX_PAGE_CHARS: 8000,
}));

const synthesizeItem = vi.fn();
vi.mock("@/lib/tech-radar/item", async () => {
  const actual = await import("@/lib/tech-radar/item");
  return { ...actual, synthesizeItem: (...a: unknown[]) => synthesizeItem(...a) };
});

const upsertTechItem = vi.fn();
vi.mock("@/lib/tech-radar/persist", () => ({ upsertTechItem: (...a: unknown[]) => upsertTechItem(...a) }));

const chooseForPerson = vi.fn();
vi.mock("@/lib/tech-radar/chooser", async () => {
  const actual = await import("@/lib/tech-radar/chooser");
  return { ...actual, chooseForPerson: (...a: unknown[]) => chooseForPerson(...a) };
});

const judgeAndDraft = vi.fn();
vi.mock("@/lib/tech-radar/judge-and-draft", () => ({ judgeAndDraft: (...a: unknown[]) => judgeAndDraft(...a) }));

const { personScan } = await import("@/lib/tech-radar/person-scan");
const { BANKING_IL_PACK } = await import("@/lib/tech-radar/sources");
const { OR_FEATURE } = await import("@/lib/tech-radar/types");

// ─── fixtures ────────────────────────────────────────────────────────────────

const ITEM_URL = "https://www.globes.co.il/news/article.aspx?did=1";
/** A real member of the shipped pack's closed list — the whole test is that this
 *  particular string survives the round trip. */
const REAL_TAG = "אשראי-צרכני";

function fresh(daysAgo = 3): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

/** Pazit, as in tech-radar-flow-v3: Israeli retail banking, capital markets not hers. */
function pazit() {
  return {
    id: "pp-pazit",
    roleLens: "בנקאות קמעונאית",
    personalNotes: null,
    audience: { type: ["B2C"], who: "משקי בית", geography: "ישראל" },
    scope: { owns: ["אשראי צרכני"], notOwns: ["שוקי הון"] },
    employerTrackedCompanyId: "tc-poalim",
    contact: {
      id: "ct-pazit",
      ownerId: "u1",
      fullName: "פזית",
      hebrewFirstName: "פזית",
      currentTitle: "ראשת בנקאות קמעונאית",
      currentCompany: "בנק הפועלים",
      experience: null,
    },
    axes: [
      {
        axisId: "ax-industry",
        personProfileId: "pp-pazit",
        source: "INDUSTRY",
        mutedAt: null,
        agenda: false,
        weight: 1,
        rationale: "רשת הענף",
        evidence: null,
        axis: { id: "ax-industry", label: "ענף: בנקאות ישראל", kind: "INDUSTRY" },
      },
    ],
  };
}

/** The two shapes prisma is asked for: the resolver's INDUSTRY query, and the scan's own. */
function wireAxes() {
  axisFindMany.mockImplementation(async (args: { where?: { kind?: string } }) =>
    args?.where?.kind === "INDUSTRY"
      ? [{ id: "ax-industry", label: "ענף: בנקאות ישראל", people: [{ personProfileId: "pp-pazit" }] }]
      : [
          {
            id: "ax-industry",
            label: "ענף: בנקאות ישראל",
            kind: "INDUSTRY",
            weight: 1,
            people: [{ mutedAt: null, evidence: null, personProfile: { id: "pp-pazit", contactId: "ct-pazit" } }],
          },
        ]
  );
}

function packItem() {
  return {
    title: "בנק ישראל פרסם הוראה חדשה על אשראי צרכני",
    url: ITEM_URL,
    snippet: "הפיקוח על הבנקים",
    publishedAt: fresh(),
    sourceHost: "globes.co.il",
  };
}

/** What a triage model returns for that item. `tags` is the field under test. */
function triageResponse(tags: unknown, url = ITEM_URL) {
  const verdict: Record<string, unknown> = {
    url,
    shareworthy: 0.9,
    stature: 0.9,
    kind: "big_news",
    publisher: "globes.co.il",
    staleness: false,
    israelRelevant: true,
    categories: ["credit"],
    technology: null,
    vendor: null,
  };
  if (tags !== undefined) verdict.industryTags = tags;
  return {
    ok: true,
    status: 200,
    data: { choices: [{ message: { content: JSON.stringify({ verdicts: [verdict] }) } }] },
  };
}

function triagePrompt(): string {
  const call = chat.mock.calls.find((c) => c[0] === OR_FEATURE.triage);
  expect(call, "triage was never called").toBeTruthy();
  const body = call![1] as { messages: { role: string; content: string }[] };
  return body.messages.find((m) => m.role === "user")!.content;
}

function lastReport(): Record<string, unknown> {
  const update = scanRunUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
  return update.data.report as Record<string, unknown>;
}

beforeEach(() => {
  for (const m of [
    axisFindMany, profileFindMany, scanRunCreate, scanRunUpdate, scanRunFindUnique, axisMatchUpsert,
    techItemUpdate, dropoutCreateMany, sourcePackFindMany, chat, fetchSourcePack, fetchPoolNews,
    readPage, synthesizeItem, upsertTechItem, chooseForPerson, judgeAndDraft,
  ]) m.mockReset();

  scanRunCreate.mockResolvedValue({ id: "run1" });
  scanRunUpdate.mockResolvedValue({});
  axisMatchUpsert.mockResolvedValue({ id: "am1" });
  techItemUpdate.mockResolvedValue({});
  dropoutCreateMany.mockResolvedValue({ count: 0 });
  // The production state this bug was measured in: NOTHING has ever written a
  // RadarSourcePack row, because nothing in the app can.
  sourcePackFindMany.mockResolvedValue([]);
  wireAxes();
  profileFindMany.mockResolvedValue([pazit()]);
  fetchSourcePack.mockResolvedValue({
    items: [packItem()],
    perSource: [{ host: "globes.co.il", name: "גלובס", items: 1, via: "rss", feedUrl: "https://x/rss" }],
  });
  fetchPoolNews.mockResolvedValue({ items: [], queriesRun: 0, cachedQueries: 0, quotaLikely: false, providerStats: [] });
  chat.mockResolvedValue(triageResponse([REAL_TAG]));
  readPage.mockResolvedValue(null);
  synthesizeItem.mockImplementation(async (input: { articles: { url: string; title: string }[] }) => ({
    title: input.articles[0].title,
    summary: "סיכום",
    technology: null,
    vendor: null,
    categories: [],
    sources: [{ url: input.articles[0].url, title: input.articles[0].title, publishedAt: fresh() }],
    publishedAt: fresh(),
    thin: true,
    shareworthy: 0.9,
    stature: 0.9,
    kind: "big_news",
  }));
  upsertTechItem.mockResolvedValue("item-1");
  chooseForPerson.mockResolvedValue({ picks: [], noneReason: "אין כלום", outcome: "none" });
  judgeAndDraft.mockResolvedValue({
    candidates: 0, ranked: 0, vetoed: 0, vetoFaults: 0, drafted: 0, dropReasons: {}, unknownSourceHosts: [],
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("a taxonomy the scan resolves reaches the real triage prompt", () => {
  /**
   * The mechanism behind the 0-of-11: `ensureSeedPack` is the only code that can insert a
   * RadarSourcePack row and NOTHING calls it, so the table is empty, so every industry
   * resolved to `no_pack`, so every triage call was made with `taxonomy: undefined` — and
   * a verdict with no taxonomy carries no `industryTags` key AT ALL, by design.
   */
  it("falls back to the shipped pack when no row was ever stored, and sends its closed list", async () => {
    await personScan("org1");

    const user = triagePrompt();
    expect(user).toContain("TAXONOMY");
    expect(user).toContain(REAL_TAG);
    // Not one tag by luck: the whole shipped vocabulary is what the model chooses from.
    for (const t of BANKING_IL_PACK.taxonomy) expect(user).toContain(t.tag);
  });

  it("pulls the shipped pack's outlets too — the free channel is not dead either", async () => {
    await personScan("org1");

    expect(fetchSourcePack).toHaveBeenCalledTimes(1);
    const pack = fetchSourcePack.mock.calls[0][0] as { industryKey: string; taxonomy: unknown[] };
    // The NORMALISED key, not the seed's own Hebrew string: the person's key and the
    // item's provenance are both compared against it, and a raw key would fail floor 0.
    expect(pack.industryKey).toBe("banking finance");
    expect(pack.taxonomy).toHaveLength(BANKING_IL_PACK.taxonomy.length);
  });

  it("reports the pack it used instead of reporting the industry as unresolved", async () => {
    await personScan("org1");

    const report = lastReport();
    expect(report.sourcePacks).toEqual([
      expect.objectContaining({ industryKey: "banking finance", taxonomyTags: BANKING_IL_PACK.taxonomy.length }),
    ]);
    expect(report.unresolvedIndustries).toEqual([]);
    expect(report.peopleWithoutPack).toEqual([]);
  });
});

describe("the tags triage returns land on the written item", () => {
  it("writes the model's on-list tag onto the TechItem row", async () => {
    await personScan("org1");

    expect(upsertTechItem).toHaveBeenCalledTimes(1);
    expect(techItemUpdate).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { industryTags: [REAL_TAG] },
    });
  });

  /** An off-list tag is DROPPED, never coerced — and dropping it must not write []
   *  over tags another pull gave the same story. */
  it("writes nothing when the model answered with tags that are not on the list", async () => {
    chat.mockResolvedValue(triageResponse(["אשראי", "crypto-moon"]));

    await personScan("org1");

    expect(upsertTechItem).toHaveBeenCalledTimes(1);
    expect(techItemUpdate).not.toHaveBeenCalled();
  });
});

describe("the report says how much of the run got tagged", () => {
  it("counts the written items that carry at least one industry tag", async () => {
    await personScan("org1");

    const report = lastReport();
    expect(report.itemsWritten).toBe(1);
    expect(report.itemsTagged).toBe(1);
    // A taxonomy was offered for one item, which is what makes itemsTagged: 0 readable
    // as a failure rather than as "no pack was involved".
    expect(report.taxonomyOffered).toBe(1);
  });

  /**
   * The run that started this: items written, a taxonomy offered, nothing tagged. It has
   * to be a NUMBER in the report, not an absence — this codebase has twice been burned by
   * a layer that silently did nothing (2026-08-27, 2026-08-24).
   */
  it("says zero out loud when a taxonomy was offered and nothing came back tagged", async () => {
    chat.mockResolvedValue(triageResponse([]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const report = await personScan("org1");

    expect(report.itemsWritten).toBe(1);
    expect(report.itemsTagged).toBe(0);
    expect(report.taxonomyOffered).toBe(1);
    // A number in a stored report nobody reads is still a silence. It has to reach the log.
    expect(warn.mock.calls.flat().join(" ")).toContain("tagging produced NOTHING");
    warn.mockRestore();
  });

  /** The named channel is triaged with NO taxonomy on purpose. Zero offered is the
   *  honest number there, and it must not read as a tagging failure. */
  it("offers no taxonomy for the named channel and does not count it as a miss", async () => {
    fetchSourcePack.mockResolvedValue({ items: [], perSource: [] });
    fetchPoolNews.mockResolvedValue({
      items: [{ title: "One Zero", url: "https://reuters.com/1", snippet: "s", publishedAt: fresh(), companyIds: ["ax-industry"] }],
      queriesRun: 1, cachedQueries: 0, quotaLikely: false, providerStats: [],
    });
    chat.mockResolvedValue(triageResponse(undefined, "https://reuters.com/1"));

    const report = await personScan("org1");

    expect(report.taxonomyOffered).toBe(0);
    expect(report.itemsTagged).toBe(0);
    expect(triagePrompt()).not.toContain("TAXONOMY");
  });
});
