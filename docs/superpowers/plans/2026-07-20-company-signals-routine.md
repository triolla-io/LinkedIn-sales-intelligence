# Company Signals Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect fresh, positive company news (funding, hiring, office moves, product launches, awards, milestones, exec hires) from multiple reliable live sources and prepare — never auto-send — a personal Hebrew congratulation to the C-level contact at that company, reviewable in a new Routine module.

**Architecture:** Mirrors the existing job-change routine one level up (company instead of person). A weekly cron selects companies that have a C-level contact owned by a module-enabled user, fans out one `company.signals.detect` event per company. Detection fetches three free-tier live news sources (Tavily + Serper + GNews) in parallel, an LLM extracts/classifies/cross-references candidate events, and only events verified by 2+ distinct publication domains (or an official company-domain source) are recorded. Each verified event fans out to `company.signals.draft`, which writes one `PENDING_REVIEW` draft per (owner, C-level contact). The customer reviews/edits in `/routine/company-signals`; approving reuses the existing `ExtensionTask` SEND path unchanged.

**Tech Stack:** Next.js (App Router — read `node_modules/next/dist/docs/` before route code), Prisma (client at `@/lib/generated/prisma/client`), Inngest, Vitest (jsdom), OpenRouter (raw fetch), Tailwind (RTL), SWR.

## Global Constraints

- **Next.js is NOT the version you know** — read the relevant guide in `node_modules/next/dist/docs/` before writing any route/page code. Heed deprecations.
- Every API route MUST be wrapped with `withTenant()` from `@/lib/tenancy/with-tenant`. Never use raw `prisma` for tenant-scoped reads — always filter by `ctx.effectiveUserId`.
- New Inngest functions go in `inngest/functions/<name>.ts` and MUST be registered in `app/api/inngest/route.ts`. Event names are inline string literals typed with `as const`.
- OpenRouter is the only LLM path (raw `fetch`, OpenAI-compatible). A missing `OPENROUTER_API_KEY` MUST throw for the drafting/extraction calls (never guess) — consistent with `lib/job-check/judge-change.ts`.
- News source clients degrade gracefully: a missing key or any error returns `[]`, never throws.
- Verified rule (verbatim from spec): an event is `verified` iff it has **2+ distinct publication domains** across combined sources, OR a single **official** source (a source URL whose host matches the company's own website host). Only `verified` events produce drafts.
- Tests: Vitest, `globals: false` → import `{ describe, it, expect, vi, beforeEach } from "vitest"`. Test files live in `tests/unit/` and `tests/integration/` (NOT co-located). Prisma is mocked via `vi.mock("@/lib/prisma", ...)`. Run one file: `npx vitest run tests/unit/<file>.test.ts`.
- Prisma migrations: this dev DB has pre-existing drift (see memory `project_prisma_migrate_dev_drift`) — `prisma migrate dev` wants to RESET. Do NOT reset. Use `--create-only` then apply manually (Task 1).
- Language: all drafted messages and user-facing UI copy are Hebrew; code/identifiers English.

---

## File Structure

**Create:**
- `lib/company-signals/clevel.ts` — C-level title detection (`isCLevelTitle`, `clevelTitleWhere`)
- `lib/news/types.ts` — `NewsResult` type
- `lib/news/tavily.ts`, `lib/news/serper.ts`, `lib/news/gnews.ts` — one adapter each
- `lib/news/fetch-company-news.ts` — parallel aggregator
- `lib/company-signals/extract.ts` — LLM extraction + pure helpers (`parseSignalsResponse`, `hostOf`, `computeVerified`, `makeDedupeKey`, `extractCompanySignals`)
- `lib/company-signals/draft.ts` — LLM congrats writer (`parseDraftJson`, `draftCongrats`)
- `lib/company-signals/detect.ts` — `detectAndRecordSignals(companyId)`
- `lib/company-signals/create-drafts.ts` — `createDraftsForSignal(signalId)`
- `inngest/functions/company-signals-tick.ts`, `company-signals-detect.ts`, `company-signals-draft.ts`
- `app/api/company-signals/route.ts` (GET list) + `app/api/company-signals/[id]/route.ts` (PATCH)
- `app/(dashboard)/routine/company-signals/page.tsx`
- Tests under `tests/unit/` and `tests/integration/`

**Modify:**
- `prisma/schema.prisma` — 2 models, 3 enums, 5 field/relation additions
- `lib/routine/modules.ts` — add `companySignals` module key
- `app/api/routine/modules/route.ts` — accept the new module key
- `inngest/functions/extension-task-result.ts` — handle `companySignalDraftId`
- `app/api/inngest/route.ts` — register 3 functions
- `components/dashboard/sidebar.tsx` — add Routine item
- `CLAUDE.md` — event index rows
- `.env.example` (or `.env`) — 3 new keys

---

### Task 1: Prisma schema — models, enums, relations, migration

**Files:**
- Modify: `prisma/schema.prisma`
- (Migration dir auto-created under `prisma/migrations/`)

**Interfaces:**
- Produces: models `CompanySignal`, `CompanySignalDraft`; enums `CompanySignalType`, `CompanySignalStatus`, `CompanySignalDraftStatus`; `Company.lastSignalCheckAt`, `Company.companySignals`; `Contact.companySignalDrafts`; `User.companySignalDrafts`; `Organization.companySignalsEnabled`; `ExtensionTask.companySignalDraftId`.

- [ ] **Step 1: Add the two models + three enums**

Append to `prisma/schema.prisma`:

```prisma
model CompanySignal {
  id          String              @id @default(cuid())
  companyId   String
  company     Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  signalType  CompanySignalType
  title       String
  summary     String              @db.Text
  eventDate   DateTime?
  confidence  Float               @default(0)
  sources     Json // [{ name, url, publishedAt }]
  verified    Boolean             @default(false)
  dedupeKey   String
  status      CompanySignalStatus @default(DETECTED)
  detectedAt  DateTime            @default(now())
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  drafts      CompanySignalDraft[]

  @@unique([companyId, dedupeKey])
  @@index([status])
}

model CompanySignalDraft {
  id           String                   @id @default(cuid())
  signalId     String
  signal       CompanySignal            @relation(fields: [signalId], references: [id], onDelete: Cascade)
  ownerId      String
  owner        User                     @relation("UserCompanySignalDrafts", fields: [ownerId], references: [id], onDelete: Cascade)
  contactId    String
  contact      Contact                  @relation(fields: [contactId], references: [id], onDelete: Cascade)
  draftMessage String                   @db.Text
  status       CompanySignalDraftStatus @default(PENDING_REVIEW)
  channel      String                   @default("LINKEDIN")
  sentAt       DateTime?
  createdAt    DateTime                 @default(now())
  updatedAt    DateTime                 @updatedAt

  @@unique([signalId, contactId])
  @@index([ownerId, status])
}

enum CompanySignalType {
  FUNDING
  HIRING_GROWTH
  OFFICE_MOVE
  PRODUCT_LAUNCH
  AWARD
  MILESTONE
  EXEC_HIRE
}

enum CompanySignalStatus {
  DETECTED
  VERIFIED
  DRAFTED
  ARCHIVED
}

enum CompanySignalDraftStatus {
  PENDING_REVIEW
  APPROVED
  SENT
  DISMISSED
}
```

- [ ] **Step 2: Wire relations + fields onto existing models**

In `model Company` add (after `lastEnrichedAt`):
```prisma
  lastSignalCheckAt DateTime?
```
and in its relations block (after `contacts Contact[]`):
```prisma
  companySignals CompanySignal[]
```

In `model Contact` relations block (after `lists ContactListMember[]`):
```prisma
  companySignalDrafts CompanySignalDraft[]
```

In `model User` relations block (after `connectionRequests ...`):
```prisma
  companySignalDrafts CompanySignalDraft[] @relation("UserCompanySignalDrafts")
```

In `model Organization` (after `jobCheckEnabled`):
```prisma
  companySignalsEnabled Boolean  @default(false)
```

In `model ExtensionTask` (after `jobChangeId String?`):
```prisma
  companySignalDraftId String?
```

- [ ] **Step 3: Create the migration WITHOUT applying (avoid the reset trap)**

Run: `npx prisma migrate dev --name add_company_signals --create-only`
Expected: prints "The following migration(s) have been created" and writes `prisma/migrations/<ts>_add_company_signals/migration.sql`. It does NOT apply or reset. If it still offers to reset, cancel and follow memory `project_prisma_migrate_dev_drift`.

- [ ] **Step 4: Apply the migration + regenerate client**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: "Applying migration ...add_company_signals", then "Generated Prisma Client". If `migrate deploy` reports drift/failed state, apply the migration SQL manually against the dev DB (see the memory note) and mark it applied with `npx prisma migrate resolve --applied <migration_name>`, then rerun `npx prisma generate`.

- [ ] **Step 5: Verify the client has the new types**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -5` (expect no errors referencing the new models) and confirm the enums exist:
Run: `grep -c "CompanySignalType" lib/generated/prisma/client/index.d.ts`
Expected: a count ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/generated/prisma
git commit -m "feat(company-signals): add CompanySignal + CompanySignalDraft schema"
```

---

### Task 2: C-level detection helper

**Files:**
- Create: `lib/company-signals/clevel.ts`
- Test: `tests/unit/clevel.test.ts`

**Interfaces:**
- Produces: `isCLevelTitle(title: string | null | undefined): boolean`; `clevelTitleWhere(): { OR: Array<{ currentTitle: { contains: string; mode: "insensitive" } }> }`.
- Pattern source: mirrors `lib/job-check/priority-titles.ts`.

- [ ] **Step 1: Write the failing test**

`tests/unit/clevel.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isCLevelTitle, clevelTitleWhere } from "@/lib/company-signals/clevel";

describe("isCLevelTitle", () => {
  it("matches English C-level titles", () => {
    expect(isCLevelTitle("Chief Executive Officer")).toBe(true);
    expect(isCLevelTitle("CTO & Co-Founder")).toBe(true);
    expect(isCLevelTitle("VP Finance")).toBe(true);
    expect(isCLevelTitle("Head of Product")).toBe(true);
  });
  it("matches Hebrew C-level titles", () => {
    expect(isCLevelTitle('סמנכ"ל כספים')).toBe(true);
    expect(isCLevelTitle("מייסד")).toBe(true);
  });
  it("rejects non-exec titles and empty", () => {
    expect(isCLevelTitle("Software Engineer")).toBe(false);
    expect(isCLevelTitle(null)).toBe(false);
    expect(isCLevelTitle("")).toBe(false);
  });
  it("clevelTitleWhere returns a Prisma OR clause", () => {
    const w = clevelTitleWhere();
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR[0]).toHaveProperty("currentTitle.mode", "insensitive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/clevel.test.ts`
Expected: FAIL — "Cannot find module '@/lib/company-signals/clevel'".

- [ ] **Step 3: Write the implementation**

`lib/company-signals/clevel.ts`:
```ts
/**
 * C-level / senior-leadership title detection. Mirrors lib/job-check/priority-titles.ts.
 * Substring, case-insensitive; covers English + Hebrew variants. Used both to gate which
 * companies we monitor (via clevelTitleWhere) and to pick draft recipients.
 */
export const CLEVEL_TITLE_TERMS = [
  // English chief titles
  "chief executive", "chief technolog", "chief technical", "chief financial",
  "chief operating", "chief marketing", "chief product", "chief revenue",
  "chief people", "chief information", "chief security", "chief data",
  "ceo", "cto", "cfo", "coo", "cmo", "cpo", "cro", "chro", "ciso", "cio",
  "founder", "co-founder", "cofounder", "owner",
  "vp ", "vice president", "head of", "svp", "evp",
  "managing director",
  // Hebrew
  'מנכ"ל', 'סמנכ"ל', "מייסד", "בעלים", "משנה למנכ",
] as const;

export function isCLevelTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return CLEVEL_TITLE_TERMS.some((term) => t.includes(term.toLowerCase()));
}

export function clevelTitleWhere(): {
  OR: Array<{ currentTitle: { contains: string; mode: "insensitive" } }>;
} {
  return {
    OR: CLEVEL_TITLE_TERMS.map((term) => ({
      currentTitle: { contains: term, mode: "insensitive" as const },
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/clevel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/company-signals/clevel.ts tests/unit/clevel.test.ts
git commit -m "feat(company-signals): C-level title detection helper"
```

---

### Task 3: News source clients (Tavily + Serper + GNews) + aggregator

**Files:**
- Create: `lib/news/types.ts`, `lib/news/tavily.ts`, `lib/news/serper.ts`, `lib/news/gnews.ts`, `lib/news/fetch-company-news.ts`
- Test: `tests/unit/news-clients.test.ts`

**Interfaces:**
- Produces: `type NewsResult = { title: string; url: string; snippet: string; source: string; publishedAt: string | null }`
- `fetchTavily(query: string): Promise<NewsResult[]>`, `fetchSerper(query)`, `fetchGnews(query)` — each returns `[]` on missing key/error.
- `fetchCompanyNews(companyName: string): Promise<NewsResult[]>` — runs all three in parallel, merges, returns combined list (may be empty).
- Env: `TAVILY_API_KEY`, `SERPER_API_KEY`, `GNEWS_API_KEY`.

- [ ] **Step 1: Write the failing test**

`tests/unit/news-clients.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTavily, fetchSerper, fetchGnews } from "@/lib/news/tavily";
import * as serper from "@/lib/news/serper";
import * as gnews from "@/lib/news/gnews";

// NOTE: import paths corrected below — see Step 3 for real module layout.
```

Replace the whole file with:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("news clients", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.resetModules();
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.GNEWS_API_KEY;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("tavily returns [] when key missing", async () => {
    const { fetchTavily } = await import("@/lib/news/tavily");
    expect(await fetchTavily("Acme funding")).toEqual([]);
  });

  it("tavily normalizes results when key present", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "Acme raises $10M", url: "https://techcrunch.com/x", content: "…", published_date: "2026-07-01" }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { fetchTavily } = await import("@/lib/news/tavily");
    const r = await fetchTavily("Acme funding");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Acme raises $10M", url: "https://techcrunch.com/x", source: "tavily" });
  });

  it("tavily returns [] on HTTP error (no throw)", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const { fetchTavily } = await import("@/lib/news/tavily");
    expect(await fetchTavily("q")).toEqual([]);
  });

  it("serper returns [] when key missing", async () => {
    const { fetchSerper } = await import("@/lib/news/serper");
    expect(await fetchSerper("q")).toEqual([]);
  });

  it("gnews returns [] when key missing", async () => {
    const { fetchGnews } = await import("@/lib/news/gnews");
    expect(await fetchGnews("q")).toEqual([]);
  });

  it("fetchCompanyNews merges all three and tolerates empties", async () => {
    process.env.TAVILY_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: "t", url: "https://a.com/1", content: "c", published_date: null }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { fetchCompanyNews } = await import("@/lib/news/fetch-company-news");
    const r = await fetchCompanyNews("Acme");
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/news-clients.test.ts`
Expected: FAIL — module `@/lib/news/tavily` not found.

- [ ] **Step 3: Write the modules**

`lib/news/types.ts`:
```ts
export type NewsResult = {
  title: string;
  url: string;
  snippet: string;
  source: string; // provider tag: "tavily" | "serper" | "gnews"
  publishedAt: string | null;
};
```

`lib/news/tavily.ts`:
```ts
import type { NewsResult } from "@/lib/news/types";

/** Tavily Search API — https://docs.tavily.com. Free tier ~1,000 searches/mo.
 *  Missing key or any error → [] (never throws). */
export async function fetchTavily(query: string): Promise<NewsResult[]> {
  const key = (process.env.TAVILY_API_KEY ?? "").trim();
  if (!key) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.tavily.com/search", {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        topic: "news",
        search_depth: "basic",
        max_results: 8,
        days: 30,
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.results) ? data.results : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: String(o.title ?? ""),
        url: String(o.url ?? ""),
        snippet: String(o.content ?? ""),
        source: "tavily",
        publishedAt: typeof o.published_date === "string" ? o.published_date : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
```

`lib/news/serper.ts`:
```ts
import type { NewsResult } from "@/lib/news/types";

/** Serper.dev news search — https://serper.dev. Free credits then ~$0.001/query.
 *  Missing key or any error → [] (never throws). */
export async function fetchSerper(query: string): Promise<NewsResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").trim();
  if (!key) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://google.serper.dev/news", {
      signal: controller.signal,
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10 }),
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.news) ? data.news : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      return {
        title: String(o.title ?? ""),
        url: String(o.link ?? ""),
        snippet: String(o.snippet ?? ""),
        source: "serper",
        publishedAt: typeof o.date === "string" ? o.date : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
```

`lib/news/gnews.ts`:
```ts
import type { NewsResult } from "@/lib/news/types";

/** GNews API — https://gnews.io. Free tier 100 req/day.
 *  Missing key or any error → [] (never throws). */
export async function fetchGnews(query: string): Promise<NewsResult[]> {
  const key = (process.env.GNEWS_API_KEY ?? "").trim();
  if (!key) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = new URL("https://gnews.io/api/v4/search");
    url.searchParams.set("q", query);
    url.searchParams.set("lang", "en");
    url.searchParams.set("max", "10");
    url.searchParams.set("apikey", key);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data?.articles) ? data.articles : [];
    return rows.map((r) => {
      const o = r as Record<string, unknown>;
      const src = o.source as Record<string, unknown> | undefined;
      return {
        title: String(o.title ?? ""),
        url: String(o.url ?? ""),
        snippet: String(o.description ?? ""),
        source: `gnews:${src?.name ?? ""}`,
        publishedAt: typeof o.publishedAt === "string" ? o.publishedAt : null,
      } satisfies NewsResult;
    }).filter((r) => r.url);
  } catch {
    return [];
  }
}
```

`lib/news/fetch-company-news.ts`:
```ts
import type { NewsResult } from "@/lib/news/types";
import { fetchTavily } from "@/lib/news/tavily";
import { fetchSerper } from "@/lib/news/serper";
import { fetchGnews } from "@/lib/news/gnews";

/** Fan out to all three providers in parallel and merge. Each provider degrades to []
 *  independently, so a missing key or a single provider outage never fails the batch. */
export async function fetchCompanyNews(companyName: string): Promise<NewsResult[]> {
  const query = `${companyName} (funding OR raises OR launches OR "new office" OR hiring OR award OR appoints)`;
  const [a, b, c] = await Promise.all([
    fetchTavily(query),
    fetchSerper(query),
    fetchGnews(companyName),
  ]);
  return [...a, ...b, ...c];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/news-clients.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/news tests/unit/news-clients.test.ts
git commit -m "feat(news): Tavily+Serper+GNews live-search clients with graceful degradation"
```

---

### Task 4: Signal extraction (LLM) + pure verify/dedup helpers

**Files:**
- Create: `lib/company-signals/extract.ts`
- Test: `tests/unit/extract-signals.test.ts`

**Interfaces:**
- Consumes: `NewsResult[]` (Task 3).
- Produces:
  - `type ExtractedSignal = { signalType: SignalTypeStr; title: string; summary: string; eventDate: string | null; sources: { name: string; url: string; publishedAt: string | null }[]; }`
  - `type SignalTypeStr = "FUNDING" | "HIRING_GROWTH" | "OFFICE_MOVE" | "PRODUCT_LAUNCH" | "AWARD" | "MILESTONE" | "EXEC_HIRE"`
  - `hostOf(url: string): string | null`
  - `computeVerified(sources: {url:string}[], companyWebsite: string | null): { verified: boolean; confidence: number; distinctDomains: number }`
  - `makeDedupeKey(signalType: string, title: string): string`
  - `parseSignalsResponse(text: string): ExtractedSignal[]`
  - `extractCompanySignals(companyName: string, news: NewsResult[]): Promise<ExtractedSignal[]>` (LLM; throws if `OPENROUTER_API_KEY` missing; returns `[]` if `news` empty)

- [ ] **Step 1: Write the failing test**

`tests/unit/extract-signals.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hostOf, computeVerified, makeDedupeKey, parseSignalsResponse } from "@/lib/company-signals/extract";

describe("hostOf", () => {
  it("extracts registrable host, strips www", () => {
    expect(hostOf("https://www.techcrunch.com/2026/x")).toBe("techcrunch.com");
    expect(hostOf("not a url")).toBe(null);
  });
});

describe("computeVerified", () => {
  it("verified when 2+ distinct domains", () => {
    const r = computeVerified(
      [{ url: "https://techcrunch.com/a" }, { url: "https://calcalist.co.il/b" }],
      null
    );
    expect(r.verified).toBe(true);
    expect(r.distinctDomains).toBe(2);
    expect(r.confidence).toBeGreaterThan(0.5);
  });
  it("not verified with a single domain and no official source", () => {
    const r = computeVerified(
      [{ url: "https://blogspot.com/a" }, { url: "https://blogspot.com/b" }],
      "https://acme.com"
    );
    expect(r.verified).toBe(false);
  });
  it("verified from a single official company-domain source", () => {
    const r = computeVerified([{ url: "https://acme.com/press/funding" }], "https://www.acme.com");
    expect(r.verified).toBe(true);
  });
});

describe("makeDedupeKey", () => {
  it("is stable for the same type+title and differs across events", () => {
    expect(makeDedupeKey("FUNDING", "Acme raises $12M Series A!"))
      .toBe(makeDedupeKey("FUNDING", "Acme raises $12M Series A"));
    expect(makeDedupeKey("FUNDING", "Series A"))
      .not.toBe(makeDedupeKey("PRODUCT_LAUNCH", "Series A"));
  });
});

describe("parseSignalsResponse", () => {
  it("parses valid JSON, drops events with no source url", () => {
    const text = JSON.stringify({ events: [
      { signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: "2026-07-01",
        sources: [{ name: "TechCrunch", url: "https://techcrunch.com/x", publishedAt: null }] },
      { signalType: "AWARD", title: "no sources", summary: "s", eventDate: null, sources: [] },
    ]});
    const out = parseSignalsResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0].signalType).toBe("FUNDING");
  });
  it("strips markdown fences and rejects unknown types", () => {
    const text = "```json\n" + JSON.stringify({ events: [
      { signalType: "LAYOFF", title: "bad", summary: "s", eventDate: null, sources: [{ name: "x", url: "https://x.com/1", publishedAt: null }] },
    ]}) + "\n```";
    expect(parseSignalsResponse(text)).toHaveLength(0);
  });
  it("returns [] on garbage", () => {
    expect(parseSignalsResponse("not json")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/extract-signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/company-signals/extract.ts`:
```ts
/**
 * LLM extraction of positive company events from merged live-news results, plus the pure
 * verify/dedup helpers. Mirrors the OpenRouter pattern in lib/enrichment/openrouter-search.ts
 * and lib/job-check/judge-change.ts. A missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
import type { NewsResult } from "@/lib/news/types";

export type SignalTypeStr =
  | "FUNDING" | "HIRING_GROWTH" | "OFFICE_MOVE" | "PRODUCT_LAUNCH"
  | "AWARD" | "MILESTONE" | "EXEC_HIRE";

const SIGNAL_TYPES: SignalTypeStr[] = [
  "FUNDING", "HIRING_GROWTH", "OFFICE_MOVE", "PRODUCT_LAUNCH", "AWARD", "MILESTONE", "EXEC_HIRE",
];

export type ExtractedSignal = {
  signalType: SignalTypeStr;
  title: string;
  summary: string;
  eventDate: string | null;
  sources: { name: string; url: string; publishedAt: string | null }[];
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function computeVerified(
  sources: { url: string }[],
  companyWebsite: string | null
): { verified: boolean; confidence: number; distinctDomains: number } {
  const domains = new Set<string>();
  for (const s of sources) {
    const h = hostOf(s.url);
    if (h) domains.add(h);
  }
  const distinctDomains = domains.size;
  const officialHost = companyWebsite ? hostOf(companyWebsite) : null;
  const hasOfficial = officialHost !== null && domains.has(officialHost);
  const verified = distinctDomains >= 2 || hasOfficial;
  // confidence: 1 domain → 0.4, 2 → 0.7, 3+ → 0.9; official bumps to at least 0.8
  let confidence = distinctDomains >= 3 ? 0.9 : distinctDomains === 2 ? 0.7 : 0.4;
  if (hasOfficial) confidence = Math.max(confidence, 0.8);
  return { verified, confidence, distinctDomains };
}

export function makeDedupeKey(signalType: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9֐-׿\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return `${signalType}:${slug}`;
}

const SYSTEM = `You extract POSITIVE, congratulation-worthy company events from news search results.

Only include events worth sending a "mazal tov / congratulations" message about:
- FUNDING (raised a round), HIRING_GROWTH (significant hiring / headcount growth),
  OFFICE_MOVE (moved to a bigger/new office), PRODUCT_LAUNCH (launched a product/tool/feature),
  AWARD (won an award/recognition), MILESTONE (IPO, big customer, major anniversary),
  EXEC_HIRE (appointed a senior executive).

STRICT RULES:
- IGNORE negative or neutral news (layoffs, lawsuits, losses, outages, controversy). Never emit them.
- Every event MUST carry at least one source with a real URL taken from the provided results. If you cannot attach a source URL, DROP the event.
- Do not invent events, numbers, or URLs. Only use what the results support.
- Prefer recent events (last ~30 days).

Return strict JSON only — no prose, no markdown fences:
{"events":[{"signalType":"FUNDING","title":"short headline","summary":"1-2 sentences","eventDate":"YYYY-MM-DD or null","sources":[{"name":"Publication","url":"https://…","publishedAt":"YYYY-MM-DD or null"}]}]}`;

function userPrompt(companyName: string, news: NewsResult[]): string {
  const lines = news.slice(0, 30).map(
    (n, i) => `[${i + 1}] (${n.source}) ${n.title}\n${n.snippet}\nURL: ${n.url}\nDate: ${n.publishedAt ?? "unknown"}`
  );
  return `Company: ${companyName}\n\nNews results:\n${lines.join("\n\n")}`;
}

export function parseSignalsResponse(text: string): ExtractedSignal[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  const events = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: ExtractedSignal[] = [];
  for (const e of events) {
    const o = e as Record<string, unknown>;
    if (!SIGNAL_TYPES.includes(o.signalType as SignalTypeStr)) continue;
    const rawSources = Array.isArray(o.sources) ? o.sources : [];
    const sources = rawSources
      .map((s) => {
        const so = s as Record<string, unknown>;
        return {
          name: typeof so.name === "string" ? so.name : "",
          url: typeof so.url === "string" ? so.url : "",
          publishedAt: typeof so.publishedAt === "string" ? so.publishedAt : null,
        };
      })
      .filter((s) => s.url.startsWith("http"));
    if (sources.length === 0) continue; // no URL → drop
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;
    out.push({
      signalType: o.signalType as SignalTypeStr,
      title,
      summary: typeof o.summary === "string" ? o.summary : "",
      eventDate: typeof o.eventDate === "string" ? o.eventDate : null,
      sources,
    });
  }
  return out;
}

export async function extractCompanySignals(
  companyName: string,
  news: NewsResult[]
): Promise<ExtractedSignal[]> {
  if (news.length === 0) return [];
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured — refusing to extract company signals");
  }
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(companyName, news) },
        ],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`company-signals extract failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    return parseSignalsResponse(text);
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/extract-signals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/company-signals/extract.ts tests/unit/extract-signals.test.ts
git commit -m "feat(company-signals): LLM event extraction + verify/dedup helpers"
```

---

### Task 5: Draft writer (LLM Hebrew congratulation)

**Files:**
- Create: `lib/company-signals/draft.ts`
- Test: `tests/unit/company-signals-draft.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks at type level (takes primitives).
- Produces:
  - `type DraftInput = { contactFullName: string; hebrewFirstName: string | null; contactTitle: string | null; companyName: string; signalType: string; signalTitle: string; signalSummary: string }`
  - `parseDraftJson(text: string): string | null`
  - `draftCongrats(input: DraftInput): Promise<string>` — throws if `OPENROUTER_API_KEY` missing; throws if output unparseable.

- [ ] **Step 1: Write the failing test**

`tests/unit/company-signals-draft.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDraftJson } from "@/lib/company-signals/draft";

describe("parseDraftJson", () => {
  it("extracts message, strips fences", () => {
    expect(parseDraftJson('```json\n{"draftMessage":"מזל טוב!"}\n```')).toBe("מזל טוב!");
  });
  it("returns null for empty/missing", () => {
    expect(parseDraftJson('{"draftMessage":""}')).toBe(null);
    expect(parseDraftJson("garbage")).toBe(null);
  });
});

describe("draftCongrats", () => {
  const realFetch = global.fetch;
  beforeEach(() => { delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => { global.fetch = realFetch; });

  const input = {
    contactFullName: "Dana Cohen", hebrewFirstName: "דנה", contactTitle: "CEO",
    companyName: "Acme", signalType: "FUNDING", signalTitle: "Raised $10M", signalSummary: "Series A",
  };

  it("throws when OPENROUTER_API_KEY missing", async () => {
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    await expect(draftCongrats(input)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it("returns the drafted message on success", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"draftMessage":"דנה, מזל טוב על הגיוס!"}' } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { draftCongrats } = await import("@/lib/company-signals/draft");
    expect(await draftCongrats(input)).toContain("מזל טוב");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/company-signals-draft.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/company-signals/draft.ts`:
```ts
/**
 * Drafts a short personal Hebrew LinkedIn congratulation for a company event.
 * Mirrors lib/job-check/judge-change.ts. Missing OPENROUTER_API_KEY THROWS (never guess).
 * Env: OPENROUTER_API_KEY (required), COMPANY_SIGNALS_MODEL (default anthropic/claude-haiku-4.5).
 */
export type DraftInput = {
  contactFullName: string;
  hebrewFirstName: string | null;
  contactTitle: string | null;
  companyName: string;
  signalType: string;
  signalTitle: string;
  signalSummary: string;
};

const SYSTEM = `You write short, warm, PERSONAL LinkedIn congratulation messages IN HEBREW about a positive event at the recipient's company.

Rules:
- 2-3 sentences, natural spoken Hebrew, warm and human — never generic boilerplate. At most one emoji.
- Address the person by their Hebrew first name if provided, otherwise their first name.
- Mention the specific event (the funding / launch / office / award) concretely by what it is.
- Do NOT ask for a meeting or pitch anything — this is a genuine congratulation only.

Return strict JSON only — no prose, no markdown fences:
{"draftMessage": string}`;

function userPrompt(i: DraftInput): string {
  const hebrew = i.hebrewFirstName ? ` (Hebrew first name: ${i.hebrewFirstName})` : "";
  return [
    `Recipient: ${i.contactFullName}${hebrew}`,
    `Recipient title: ${i.contactTitle ?? "unknown"}`,
    `Company: ${i.companyName}`,
    `Event type: ${i.signalType}`,
    `Event: ${i.signalTitle}`,
    `Details: ${i.signalSummary}`,
  ].join("\n");
}

export function parseDraftJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    const parsed = JSON.parse(candidate);
    const msg = parsed?.draftMessage;
    return typeof msg === "string" && msg.trim().length > 0 ? msg.trim() : null;
  } catch {
    return null;
  }
}

export async function draftCongrats(input: DraftInput): Promise<string> {
  const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured — refusing to draft congratulations");
  }
  const model = process.env.COMPANY_SIGNALS_MODEL ?? "anthropic/claude-haiku-4.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sales.triolla.io",
        "X-Title": "Triolla Sales Intelligence",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(input) },
        ],
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`company-signals draft failed: HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    const msg = parseDraftJson(text);
    if (!msg) throw new Error("company-signals draft returned unparseable output");
    return msg;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/company-signals-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/company-signals/draft.ts tests/unit/company-signals-draft.test.ts
git commit -m "feat(company-signals): Hebrew congratulation draft writer"
```

---

### Task 6: Detection core — fetch → extract → upsert (dedup)

**Files:**
- Create: `lib/company-signals/detect.ts`
- Test: `tests/unit/detect-signals.test.ts`

**Interfaces:**
- Consumes: `fetchCompanyNews` (Task 3), `extractCompanySignals`, `computeVerified`, `makeDedupeKey` (Task 4).
- Produces: `detectAndRecordSignals(companyId: string): Promise<{ detected: number; verifiedNewIds: string[] }>` — fetches news for the company, extracts events, upserts `CompanySignal` (skipping existing `dedupeKey`), sets `Company.lastSignalCheckAt`, and returns the ids of newly-created **verified** signals.

- [ ] **Step 1: Write the failing test**

`tests/unit/detect-signals.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCompanyFindUniqueOrThrow = vi.fn();
const mockCompanyUpdate = vi.fn();
const mockSignalFindUnique = vi.fn();
const mockSignalCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findUniqueOrThrow: (...a: unknown[]) => mockCompanyFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockCompanyUpdate(...a),
    },
    companySignal: {
      findUnique: (...a: unknown[]) => mockSignalFindUnique(...a),
      create: (...a: unknown[]) => mockSignalCreate(...a),
    },
  },
}));

vi.mock("@/lib/news/fetch-company-news", () => ({ fetchCompanyNews: vi.fn() }));
vi.mock("@/lib/company-signals/extract", async (orig) => {
  const actual = await orig<typeof import("@/lib/company-signals/extract")>();
  return { ...actual, extractCompanySignals: vi.fn() };
});

import { detectAndRecordSignals } from "@/lib/company-signals/detect";
import { fetchCompanyNews } from "@/lib/news/fetch-company-news";
import { extractCompanySignals } from "@/lib/company-signals/extract";

const mockNews = vi.mocked(fetchCompanyNews);
const mockExtract = vi.mocked(extractCompanySignals);

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyFindUniqueOrThrow.mockResolvedValue({ id: "co1", name: "Acme", website: "https://acme.com" });
  mockCompanyUpdate.mockResolvedValue({});
  mockSignalFindUnique.mockResolvedValue(null);
  mockSignalCreate.mockImplementation(async (args: { data: { verified: boolean } }) => ({
    id: "sig1", verified: args.data.verified,
  }));
});

describe("detectAndRecordSignals", () => {
  it("creates a verified signal and returns its id", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(res.detected).toBe(1);
    expect(res.verifiedNewIds).toEqual(["sig1"]);
    expect(mockCompanyUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSignalCheckAt: expect.any(Date) }) }));
  });

  it("skips an event whose dedupeKey already exists", async () => {
    mockSignalFindUnique.mockResolvedValue({ id: "existing" });
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "FUNDING", title: "Raised $10M", summary: "s", eventDate: null,
      sources: [{ name: "TC", url: "https://techcrunch.com/a", publishedAt: null }, { name: "CC", url: "https://calcalist.co.il/b", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).not.toHaveBeenCalled();
    expect(res.verifiedNewIds).toEqual([]);
  });

  it("records an unverified single-domain event but does NOT return it", async () => {
    mockNews.mockResolvedValue([{ title: "t", url: "https://x.com/1", snippet: "s", source: "tavily", publishedAt: null }]);
    mockExtract.mockResolvedValue([{
      signalType: "AWARD", title: "Won X", summary: "s", eventDate: null,
      sources: [{ name: "Blog", url: "https://blog.example.com/a", publishedAt: null }],
    }]);
    const res = await detectAndRecordSignals("co1");
    expect(mockSignalCreate).toHaveBeenCalledOnce();
    expect(res.verifiedNewIds).toEqual([]);
  });

  it("exits quietly (still bumps lastSignalCheckAt) when no news", async () => {
    mockNews.mockResolvedValue([]);
    mockExtract.mockResolvedValue([]);
    const res = await detectAndRecordSignals("co1");
    expect(res).toEqual({ detected: 0, verifiedNewIds: [] });
    expect(mockCompanyUpdate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/detect-signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/company-signals/detect.ts`:
```ts
/**
 * Company-signal detection core (source-agnostic, callable by the Inngest detect function).
 * Fetch merged live news → LLM extract → upsert CompanySignal (dedup on companyId+dedupeKey)
 * → advance Company.lastSignalCheckAt. Returns ids of newly-created VERIFIED signals so the
 * caller can fan out drafting. extractCompanySignals THROWS on LLM failure so the Inngest step
 * retries — never guess.
 */
import { prisma } from "@/lib/prisma";
import { fetchCompanyNews } from "@/lib/news/fetch-company-news";
import {
  extractCompanySignals,
  computeVerified,
  makeDedupeKey,
} from "@/lib/company-signals/extract";
import { Prisma } from "@/lib/generated/prisma/client";

export async function detectAndRecordSignals(
  companyId: string
): Promise<{ detected: number; verifiedNewIds: string[] }> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true, website: true },
  });

  const news = await fetchCompanyNews(company.name);
  const events = news.length > 0 ? await extractCompanySignals(company.name, news) : [];

  const verifiedNewIds: string[] = [];
  let detected = 0;

  for (const e of events) {
    const dedupeKey = makeDedupeKey(e.signalType, e.title);
    const existing = await prisma.companySignal.findUnique({
      where: { companyId_dedupeKey: { companyId: company.id, dedupeKey } },
      select: { id: true },
    });
    if (existing) continue;

    const { verified, confidence } = computeVerified(e.sources, company.website);
    const created = await prisma.companySignal.create({
      data: {
        companyId: company.id,
        signalType: e.signalType,
        title: e.title,
        summary: e.summary,
        eventDate: e.eventDate ? new Date(e.eventDate) : null,
        confidence,
        sources: e.sources as unknown as Prisma.InputJsonValue,
        verified,
        dedupeKey,
        status: verified ? "VERIFIED" : "DETECTED",
      },
      select: { id: true, verified: true },
    });
    detected += 1;
    if (created.verified) verifiedNewIds.push(created.id);
  }

  await prisma.company.update({
    where: { id: company.id },
    data: { lastSignalCheckAt: new Date() },
  });

  return { detected, verifiedNewIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/detect-signals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/company-signals/detect.ts tests/unit/detect-signals.test.ts
git commit -m "feat(company-signals): detection core with dedup + verify gate"
```

---

### Task 7: Draft-creation core — one PENDING_REVIEW draft per (owner, C-level contact)

**Files:**
- Create: `lib/company-signals/create-drafts.ts`
- Test: `tests/unit/create-drafts.test.ts`

**Interfaces:**
- Consumes: `draftCongrats` (Task 5), `clevelTitleWhere`/`isCLevelTitle` (Task 2).
- Produces: `createDraftsForSignal(signalId: string): Promise<{ created: number }>` — loads the signal + its company's C-level contacts owned by module-enabled orgs; for each contact, drafts a Hebrew congrats, creates a `CompanySignalDraft` (PENDING_REVIEW) idempotently (skip if `(signalId, contactId)` exists), upserts the contact into the owner's "איתותי חברה" `ContactList`; finally sets the signal to `DRAFTED`.

- [ ] **Step 1: Write the failing test**

`tests/unit/create-drafts.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignalFindUniqueOrThrow = vi.fn();
const mockContactFindMany = vi.fn();
const mockDraftFindUnique = vi.fn();
const mockDraftCreate = vi.fn();
const mockListUpsert = vi.fn();
const mockMemberUpsert = vi.fn();
const mockSignalUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companySignal: {
      findUniqueOrThrow: (...a: unknown[]) => mockSignalFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockSignalUpdate(...a),
    },
    contact: { findMany: (...a: unknown[]) => mockContactFindMany(...a) },
    companySignalDraft: {
      findUnique: (...a: unknown[]) => mockDraftFindUnique(...a),
      create: (...a: unknown[]) => mockDraftCreate(...a),
    },
    contactList: { upsert: (...a: unknown[]) => mockListUpsert(...a) },
    contactListMember: { upsert: (...a: unknown[]) => mockMemberUpsert(...a) },
  },
}));

vi.mock("@/lib/company-signals/draft", () => ({ draftCongrats: vi.fn() }));

import { createDraftsForSignal } from "@/lib/company-signals/create-drafts";
import { draftCongrats } from "@/lib/company-signals/draft";

const mockDraft = vi.mocked(draftCongrats);

beforeEach(() => {
  vi.clearAllMocks();
  mockSignalFindUniqueOrThrow.mockResolvedValue({
    id: "sig1", signalType: "FUNDING", title: "Raised $10M", summary: "Series A",
    company: { id: "co1", name: "Acme" },
  });
  mockContactFindUnique_default();
  mockDraftFindUnique.mockResolvedValue(null);
  mockListUpsert.mockResolvedValue({ id: "list1" });
  mockDraft.mockResolvedValue("דנה, מזל טוב על הגיוס!");
});
function mockContactFindUnique_default() {
  mockContactFindMany.mockResolvedValue([
    { id: "ct1", ownerId: "o1", fullName: "Dana Cohen", hebrewFirstName: "דנה", currentTitle: "CEO" },
  ]);
}

describe("createDraftsForSignal", () => {
  it("creates a draft per C-level contact and sets signal DRAFTED", async () => {
    const res = await createDraftsForSignal("sig1");
    expect(res.created).toBe(1);
    expect(mockDraftCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ signalId: "sig1", contactId: "ct1", ownerId: "o1", status: "PENDING_REVIEW" }),
    }));
    expect(mockSignalUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DRAFTED" } }));
  });

  it("is idempotent — skips a contact that already has a draft", async () => {
    mockDraftFindUnique.mockResolvedValue({ id: "existing" });
    const res = await createDraftsForSignal("sig1");
    expect(mockDraftCreate).not.toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/create-drafts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`lib/company-signals/create-drafts.ts`:
```ts
/**
 * For a verified CompanySignal, draft one PENDING_REVIEW congratulation per C-level contact
 * at that company whose owner's org has the company-signals module enabled. Idempotent per
 * (signalId, contactId). Adds each contact to the owner's "איתותי חברה" list (same pattern as
 * the job-change "Job Changes" list). Sets the signal to DRAFTED when done.
 */
import { prisma } from "@/lib/prisma";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { draftCongrats } from "@/lib/company-signals/draft";

const LIST_NAME = "איתותי חברה";

export async function createDraftsForSignal(signalId: string): Promise<{ created: number }> {
  const signal = await prisma.companySignal.findUniqueOrThrow({
    where: { id: signalId },
    select: {
      id: true, signalType: true, title: true, summary: true,
      company: { select: { id: true, name: true } },
    },
  });

  // C-level contacts at this company whose owner's org enabled the module.
  const contacts = await prisma.contact.findMany({
    where: {
      companyId: signal.company.id,
      removedAt: null,
      linkedinUrl: { not: "" },
      owner: { org: { companySignalsEnabled: true } },
      ...clevelTitleWhere(),
    },
    select: { id: true, ownerId: true, fullName: true, hebrewFirstName: true, currentTitle: true },
  });

  let created = 0;
  for (const c of contacts) {
    const exists = await prisma.companySignalDraft.findUnique({
      where: { signalId_contactId: { signalId: signal.id, contactId: c.id } },
      select: { id: true },
    });
    if (exists) continue;

    const message = await draftCongrats({
      contactFullName: c.fullName,
      hebrewFirstName: c.hebrewFirstName,
      contactTitle: c.currentTitle,
      companyName: signal.company.name,
      signalType: signal.signalType,
      signalTitle: signal.title,
      signalSummary: signal.summary,
    });

    let list;
    try {
      list = await prisma.contactList.upsert({
        where: { ownerId_name: { ownerId: c.ownerId, name: LIST_NAME } },
        create: { ownerId: c.ownerId, name: LIST_NAME },
        update: {},
      });
    } catch {
      list = await prisma.contactList.findUniqueOrThrow({
        where: { ownerId_name: { ownerId: c.ownerId, name: LIST_NAME } },
      });
    }

    await prisma.companySignalDraft.create({
      data: { signalId: signal.id, contactId: c.id, ownerId: c.ownerId, draftMessage: message, status: "PENDING_REVIEW" },
    });
    await prisma.contactListMember.upsert({
      where: { listId_contactId: { listId: list.id, contactId: c.id } },
      create: { listId: list.id, contactId: c.id },
      update: {},
    });
    created += 1;
  }

  await prisma.companySignal.update({ where: { id: signal.id }, data: { status: "DRAFTED" } });
  return { created };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/create-drafts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/company-signals/create-drafts.ts tests/unit/create-drafts.test.ts
git commit -m "feat(company-signals): per-owner C-level draft creation core"
```

---

### Task 8: Inngest functions (tick + detect + draft) + registration + event index

**Files:**
- Create: `inngest/functions/company-signals-tick.ts`, `inngest/functions/company-signals-detect.ts`, `inngest/functions/company-signals-draft.ts`
- Modify: `app/api/inngest/route.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `clevelTitleWhere` (Task 2), `detectAndRecordSignals` (Task 6), `createDraftsForSignal` (Task 7).
- Produces: events `company.signals.detect` (`{ companyId: string }`) and `company.signals.draft` (`{ signalId: string }`); exports `companySignalsTick`, `companySignalsDetect`, `companySignalsDraft`.
- Cron: `0 4 * * 0` (weekly, Sunday 04:00). Daily company cap: `WEEKLY_CAP = 200`.

- [ ] **Step 1: Write the tick function**

`inngest/functions/company-signals-tick.ts`:
```ts
import { inngest } from "@/inngest/client";
import { clevelTitleWhere } from "@/lib/company-signals/clevel";
import { prisma } from "@/lib/prisma";

/** Cap on companies dispatched per tick — bounds free-tier news-API usage (esp. GNews 100/day). */
const WEEKLY_CAP = 200;

export const companySignalsTick = inngest.createFunction(
  { id: "company-signals-tick", triggers: [{ cron: "0 4 * * 0" }] },
  async () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    // Companies with ≥1 C-level contact owned by a module-enabled org, not checked in 7 days.
    const companies = await prisma.company.findMany({
      where: {
        AND: [
          { OR: [{ lastSignalCheckAt: null }, { lastSignalCheckAt: { lt: cutoff } }] },
          {
            contacts: {
              some: {
                removedAt: null,
                linkedinUrl: { not: "" },
                owner: { org: { companySignalsEnabled: true } },
                ...clevelTitleWhere(),
              },
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { lastSignalCheckAt: "asc" }, // oldest-first, drains evenly
      take: WEEKLY_CAP,
    });

    if (companies.length === 0) return { dispatched: 0 };

    await inngest.send(
      companies.map((c) => ({ name: "company.signals.detect" as const, data: { companyId: c.id } }))
    );
    return { dispatched: companies.length };
  }
);
```

- [ ] **Step 2: Write the detect function**

`inngest/functions/company-signals-detect.ts`:
```ts
import { inngest } from "@/inngest/client";
import { detectAndRecordSignals } from "@/lib/company-signals/detect";

export const companySignalsDetect = inngest.createFunction(
  { id: "company-signals-detect", concurrency: 4, triggers: [{ event: "company.signals.detect" as const }] },
  async ({ event, step }) => {
    const { companyId } = event.data as { companyId: string };
    const { detected, verifiedNewIds } = await step.run("detect", () =>
      detectAndRecordSignals(companyId)
    );
    if (verifiedNewIds.length > 0) {
      await step.sendEvent(
        "fan-out-draft",
        verifiedNewIds.map((signalId) => ({ name: "company.signals.draft" as const, data: { signalId } }))
      );
    }
    return { detected, drafted: verifiedNewIds.length };
  }
);
```

- [ ] **Step 3: Write the draft function**

`inngest/functions/company-signals-draft.ts`:
```ts
import { inngest } from "@/inngest/client";
import { createDraftsForSignal } from "@/lib/company-signals/create-drafts";

export const companySignalsDraft = inngest.createFunction(
  { id: "company-signals-draft", concurrency: 4, triggers: [{ event: "company.signals.draft" as const }] },
  async ({ event, step }) => {
    const { signalId } = event.data as { signalId: string };
    const { created } = await step.run("create-drafts", () => createDraftsForSignal(signalId));
    return { created };
  }
);
```

Note: confirm the `inngest.createFunction` options shape (`concurrency`, `triggers`) matches the version in this repo by comparing against `inngest/functions/job-check-tick.ts` and `inngest/functions/extension-task-result.ts` (both read in prep). `job-check-contact.ts` shows the per-event `{ event }` and `step` usage — match it. Read `node_modules/inngest` types if `step.sendEvent`/`concurrency` differ.

- [ ] **Step 4: Register the three functions**

In `app/api/inngest/route.ts`, add imports after the `hubspotSyncApollo` import:
```ts
import { companySignalsTick } from "@/inngest/functions/company-signals-tick";
import { companySignalsDetect } from "@/inngest/functions/company-signals-detect";
import { companySignalsDraft } from "@/inngest/functions/company-signals-draft";
```
and add to the `functions: [ ... ]` array (after `hubspotSyncApollo,`):
```ts
    companySignalsTick,
    companySignalsDetect,
    companySignalsDraft,
```

- [ ] **Step 5: Add event-index rows to CLAUDE.md**

In the "Inngest event index" table in `CLAUDE.md`, add:
```
| `company.signals.detect` | weekly tick (cron 0 4 * * 0) | `inngest/functions/company-signals-detect.ts` |
| `company.signals.draft` | after a verified signal is detected | `inngest/functions/company-signals-draft.ts` |
| *(cron 0 4 \* \* 0)* | weekly company-signals trigger | `inngest/functions/company-signals-tick.ts` |
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "company-signals" | head`
Expected: no output (no type errors in the new files).

- [ ] **Step 7: Commit**

```bash
git add inngest/functions/company-signals-*.ts app/api/inngest/route.ts CLAUDE.md
git commit -m "feat(company-signals): Inngest tick+detect+draft pipeline"
```

---

### Task 9: Routine module toggle (per-org `companySignals`)

**Files:**
- Modify: `lib/routine/modules.ts`, `app/api/routine/modules/route.ts`
- Test: `tests/unit/routine-modules.test.ts`

**Interfaces:**
- Consumes: `Organization.companySignalsEnabled` (Task 1).
- Produces: `RoutineModuleKey` now includes `"companySignals"`; `RoutineModuleState` gains `companySignalsEnabled: boolean`; `getRoutineModuleState`/`setRoutineModule` handle it.

- [ ] **Step 1: Write the failing test**

`tests/unit/routine-modules.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUserFindUnique = vi.fn();
const mockUserFindUniqueOrThrow = vi.fn();
const mockOrgUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockUserFindUniqueOrThrow(...a),
      update: vi.fn(),
    },
    organization: { update: (...a: unknown[]) => mockOrgUpdate(...a) },
  },
}));

import { getRoutineModuleState, setRoutineModule } from "@/lib/routine/modules";

beforeEach(() => vi.clearAllMocks());

describe("routine modules — companySignals", () => {
  it("reports companySignalsEnabled from the org", async () => {
    mockUserFindUnique.mockResolvedValue({
      routineConnectionsEnabled: true,
      org: { jobCheckEnabled: false, companySignalsEnabled: true },
    });
    const state = await getRoutineModuleState("u1");
    expect(state.companySignalsEnabled).toBe(true);
  });

  it("setRoutineModule('companySignals') updates the org", async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({ orgId: "org1" });
    await setRoutineModule("u1", "companySignals", true);
    expect(mockOrgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { companySignalsEnabled: true } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/routine-modules.test.ts`
Expected: FAIL — `companySignalsEnabled` undefined / not handled.

- [ ] **Step 3: Edit `lib/routine/modules.ts`**

Replace the file body with:
```ts
import { prisma } from "@/lib/prisma";

export type RoutineModuleKey = "connections" | "jobChecks" | "companySignals";

export type RoutineModuleState = {
  connectionsEnabled: boolean;
  jobChecksEnabled: boolean;
  companySignalsEnabled: boolean;
};

/** connections is per-user; job checks and company signals are per-org. */
export async function getRoutineModuleState(userId: string): Promise<RoutineModuleState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      routineConnectionsEnabled: true,
      org: { select: { jobCheckEnabled: true, companySignalsEnabled: true } },
    },
  });
  return {
    connectionsEnabled: user?.routineConnectionsEnabled ?? true,
    jobChecksEnabled: user?.org.jobCheckEnabled ?? false,
    companySignalsEnabled: user?.org.companySignalsEnabled ?? false,
  };
}

export async function setRoutineModule(
  userId: string,
  module: RoutineModuleKey,
  enabled: boolean
): Promise<void> {
  if (module === "connections") {
    await prisma.user.update({ where: { id: userId }, data: { routineConnectionsEnabled: enabled } });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { orgId: true } });
  if (module === "jobChecks") {
    await prisma.organization.update({ where: { id: user.orgId }, data: { jobCheckEnabled: enabled } });
    return;
  }
  await prisma.organization.update({ where: { id: user.orgId }, data: { companySignalsEnabled: enabled } });
}
```

- [ ] **Step 4: Edit the modules API route validation**

In `app/api/routine/modules/route.ts`, change the guard line:
```ts
  if ((module !== "connections" && module !== "jobChecks") || typeof enabled !== "boolean") {
```
to:
```ts
  if (
    (module !== "connections" && module !== "jobChecks" && module !== "companySignals") ||
    typeof enabled !== "boolean"
  ) {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/routine-modules.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/routine/modules.ts app/api/routine/modules/route.ts tests/unit/routine-modules.test.ts
git commit -m "feat(company-signals): companySignals routine module toggle (per-org)"
```

---

### Task 10: API routes — GET list + PATCH approve/dismiss

**Files:**
- Create: `app/api/company-signals/route.ts` (GET), `app/api/company-signals/[id]/route.ts` (PATCH)
- Test: `tests/integration/company-signals-route.test.ts`

**Interfaces:**
- Consumes: `withTenant` (`ctx.effectiveUserId`), `CompanySignalDraft` model, `ExtensionTask` with `companySignalDraftId` (Task 1).
- Produces: `PATCH /api/company-signals/[id]` body `{ action: "approve"; message: string } | { action: "dismiss" }`; guarded PENDING_REVIEW→APPROVED that creates an `ExtensionTask` kind `SEND` carrying `companySignalDraftId`. `GET /api/company-signals` returns PENDING_REVIEW drafts for `ctx.effectiveUserId` with signal + contact detail.

- [ ] **Step 1: Read the Next.js route guide**

Run: `ls node_modules/next/dist/docs/ && sed -n '1,80p' node_modules/next/dist/docs/*route*handler* 2>/dev/null | head -80`
Purpose: confirm the current App Router route-handler signature/exports before writing. Match `app/api/job-changes/[id]/route.ts` exactly (it uses `withTenant` and extracts `id` from `req.nextUrl.pathname`).

- [ ] **Step 2: Write the failing integration test**

`tests/integration/company-signals-route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDraftFindFirst = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockTaskCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    companySignalDraft: {
      findFirst: (...a: unknown[]) => mockDraftFindFirst(...a),
      update: (...a: unknown[]) => mockDraftUpdate(...a),
      updateMany: (...a: unknown[]) => mockDraftUpdateMany(...a),
    },
    extensionTask: { create: (...a: unknown[]) => mockTaskCreate(...a) },
  },
  Prisma: { InputJsonValue: {} },
}));

// withTenant → call handler with a fixed ctx.
vi.mock("@/lib/tenancy/with-tenant", () => ({
  withTenant: (h: (req: unknown, ctx: unknown) => unknown) => (req: unknown) =>
    h(req, { effectiveUserId: "u1" }),
}));
vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: {} }));

import { PATCH } from "@/app/api/company-signals/[id]/route";

function reqWith(id: string, body: unknown) {
  return {
    nextUrl: { pathname: `/api/company-signals/${id}` },
    json: async () => body,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDraftFindFirst.mockResolvedValue({
    id: "d1", status: "PENDING_REVIEW",
    contact: { fullName: "Dana", linkedinUrl: "https://linkedin.com/in/dana" },
  });
  mockDraftUpdateMany.mockResolvedValue({ count: 1 });
});

describe("PATCH /api/company-signals/[id]", () => {
  it("approve creates a SEND ExtensionTask with companySignalDraftId", async () => {
    const res = await PATCH(reqWith("d1", { action: "approve", message: "מזל טוב!" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "SEND", companySignalDraftId: "d1", userId: "u1" }),
    }));
  });

  it("returns 409 when not pending (guarded transition)", async () => {
    mockDraftUpdateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(reqWith("d1", { action: "approve", message: "x" }) as never);
    expect((res as Response).status).toBe(409);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("dismiss sets DISMISSED without a task", async () => {
    const res = await PATCH(reqWith("d1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(200);
    expect(mockDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "DISMISSED" } }));
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("404 when the draft is not owned by the caller", async () => {
    mockDraftFindFirst.mockResolvedValue(null);
    const res = await PATCH(reqWith("d1", { action: "dismiss" }) as never);
    expect((res as Response).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/integration/company-signals-route.test.ts`
Expected: FAIL — module `@/app/api/company-signals/[id]/route` not found.

- [ ] **Step 4: Write the PATCH route**

`app/api/company-signals/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

type Body = { action: "approve"; message: string } | { action: "dismiss" };

export const PATCH = withTenant(async (req: NextRequest, ctx) => {
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = (await req.json()) as Body;

  const draft = await prisma.companySignalDraft.findFirst({
    where: { id, ownerId: ctx.effectiveUserId },
    include: { contact: { select: { fullName: true, linkedinUrl: true } } },
  });
  if (!draft) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body.action === "dismiss") {
    await prisma.companySignalDraft.update({ where: { id: draft.id }, data: { status: "DISMISSED" } });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "approve") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  if (!draft.contact.linkedinUrl) {
    return NextResponse.json({ error: "no_linkedin_url" }, { status: 400 });
  }

  // Guarded transition: only PENDING_REVIEW → APPROVED queues a send, so a double-click can't send twice.
  const claimed = await prisma.companySignalDraft.updateMany({
    where: { id: draft.id, status: "PENDING_REVIEW" },
    data: { status: "APPROVED", draftMessage: message },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "not_pending" }, { status: 409 });

  await prisma.extensionTask.create({
    data: {
      userId: ctx.effectiveUserId,
      kind: "SEND",
      payload: {
        linkedinUrl: draft.contact.linkedinUrl,
        text: message,
        recipientName: draft.contact.fullName ?? "",
      } as Prisma.InputJsonValue,
      companySignalDraftId: draft.id,
      scheduledFor: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5: Write the GET list route**

`app/api/company-signals/route.ts`:
```ts
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/tenancy/with-tenant";
import { prisma } from "@/lib/prisma";

export const GET = withTenant(async (_req, ctx) => {
  const drafts = await prisma.companySignalDraft.findMany({
    where: { ownerId: ctx.effectiveUserId, status: "PENDING_REVIEW" },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      draftMessage: true,
      createdAt: true,
      contact: { select: { fullName: true, currentTitle: true, linkedinUrl: true } },
      signal: {
        select: {
          signalType: true, title: true, summary: true, confidence: true,
          sources: true, eventDate: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json({ drafts });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/company-signals-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/company-signals tests/integration/company-signals-route.test.ts
git commit -m "feat(company-signals): review API (GET list + guarded approve/dismiss PATCH)"
```

---

### Task 11: extension-task-result — flip draft to SENT / back to PENDING_REVIEW

**Files:**
- Modify: `inngest/functions/extension-task-result.ts`
- Test: `tests/unit/extension-task-result-company-signals.test.ts`

**Interfaces:**
- Consumes: `ExtensionTask.companySignalDraftId` (Task 1), `CompanySignalDraft` model.
- Produces: on SEND success with `companySignalDraftId`, create a `SentMessage` and set the draft `SENT` + `sentAt`; on SEND failure, revert `APPROVED → PENDING_REVIEW`. Mirrors the existing `jobChangeId` handling.

- [ ] **Step 1: Add the success branch**

In `inngest/functions/extension-task-result.ts`, inside `handleSendSuccess`, immediately AFTER the closing `}` of the existing `if (task.jobChangeId) { ... return; }` block (i.e. before `if (task.recipientId) {`), insert:
```ts
  if (task.companySignalDraftId) {
    const draft = await prisma.companySignalDraft.findUnique({
      where: { id: task.companySignalDraftId },
      select: { id: true, contactId: true },
    });
    if (draft) {
      const sent = await prisma.sentMessage.create({
        data: {
          senderId: task.userId,
          actorId: task.userId,
          contactId: draft.contactId,
          body: payload.text ?? "",
          status: "SENT",
          sentAt: result.sentAt ? new Date(result.sentAt) : new Date(),
        },
      });
      await prisma.companySignalDraft.update({
        where: { id: draft.id },
        data: { status: "SENT", sentAt: sent.sentAt },
      });
    }
    return;
  }
```

- [ ] **Step 2: Add the failure branch**

In `handleSendFailure`, immediately AFTER the existing `if (task.jobChangeId) { ... return; }` block, insert:
```ts
  if (task.companySignalDraftId) {
    await prisma.companySignalDraft.updateMany({
      where: { id: task.companySignalDraftId, status: "APPROVED" },
      data: { status: "PENDING_REVIEW" },
    });
    return;
  }
```

- [ ] **Step 3: Write the test**

`tests/unit/extension-task-result-company-signals.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTaskFindUnique = vi.fn();
const mockDraftFindUnique = vi.fn();
const mockDraftUpdate = vi.fn();
const mockDraftUpdateMany = vi.fn();
const mockSentCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    extensionTask: { findUnique: (...a: unknown[]) => mockTaskFindUnique(...a) },
    companySignalDraft: {
      findUnique: (...a: unknown[]) => mockDraftFindUnique(...a),
      update: (...a: unknown[]) => mockDraftUpdate(...a),
      updateMany: (...a: unknown[]) => mockDraftUpdateMany(...a),
    },
    sentMessage: { create: (...a: unknown[]) => mockSentCreate(...a) },
  },
}));
vi.mock("@/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: vi.fn() } }));
vi.mock("@/lib/generated/prisma/client", () => ({ Prisma: {} }));
vi.mock("@/lib/sequences/gating", () => ({ maybeCompleteEnrollment: vi.fn() }));
vi.mock("@/lib/prospecting/candidates", () => ({ persistCandidates: vi.fn() }));
vi.mock("@/lib/prospecting/connect-scheduler", () => ({ queueNextConnect: vi.fn(), releaseConnectSlot: vi.fn(), SEARCH_FAIL_CAP: 3 }));
vi.mock("@/lib/prospecting/search-url", () => ({ buildSearchUrl: vi.fn(), parseSearchTitles: vi.fn() }));
vi.mock("@/lib/prospecting/events", () => ({ logProspectingEvent: vi.fn() }));
vi.mock("@/lib/prospecting/company-discovery", () => ({
  buildCompanySearchUrl: vi.fn(), enqueueCompanySearchTask: vi.fn(), failCompanyTarget: vi.fn(),
  interCompanyDelayMs: vi.fn(), maybeCompleteCompanyRun: vi.fn(), startNextPendingTarget: vi.fn(),
}));

import { extensionTaskResultHandler } from "@/inngest/functions/extension-task-result";

beforeEach(() => {
  vi.clearAllMocks();
  mockSentCreate.mockResolvedValue({ id: "sm1", sentAt: new Date() });
  mockDraftFindUnique.mockResolvedValue({ id: "d1", contactId: "c1" });
});

describe("extension-task-result — company signal drafts", () => {
  it("SEND success flips the draft to SENT", async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: "t1", kind: "SEND", status: "DONE", userId: "u1",
      companySignalDraftId: "d1", result: {}, payload: { text: "מזל טוב" },
    });
    await extensionTaskResultHandler({ event: { data: { taskId: "t1" } } });
    expect(mockSentCreate).toHaveBeenCalledOnce();
    expect(mockDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
  });

  it("SEND failure reverts APPROVED → PENDING_REVIEW", async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: "t1", kind: "SEND", status: "FAILED", userId: "u1",
      companySignalDraftId: "d1", result: {}, payload: {},
    });
    await extensionTaskResultHandler({ event: { data: { taskId: "t1" } } });
    expect(mockDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "d1", status: "APPROVED" }, data: { status: "PENDING_REVIEW" },
    }));
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/extension-task-result-company-signals.test.ts`
Expected: PASS (2 tests). If unrelated prospecting imports break the mock graph, extend the `vi.mock` list above to cover any newly-imported module (match the import list at the top of `extension-task-result.ts`).

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/extension-task-result.ts tests/unit/extension-task-result-company-signals.test.ts
git commit -m "feat(company-signals): send-result handling flips draft SENT / reverts on failure"
```

---

### Task 12: UI — sidebar item + review page + module toggle

**Files:**
- Modify: `components/dashboard/sidebar.tsx`
- Create: `app/(dashboard)/routine/company-signals/page.tsx`

**Interfaces:**
- Consumes: `GET /api/company-signals`, `PATCH /api/company-signals/[id]`, `GET/PATCH /api/routine/modules` (module key `companySignals`).
- Produces: a client page listing PENDING_REVIEW drafts with editable text, confidence + source links, approve/dismiss, and a per-org module Switch. Follows the existing routine page style (RTL, Tailwind, `useSWR`) as in `app/(dashboard)/routine/job-changes/page.tsx`.

- [ ] **Step 1: Add the sidebar item**

In `components/dashboard/sidebar.tsx`, ensure `Sparkles` (or another lucide icon already imported; if not, add `Sparkles` to the existing `lucide-react` import) and extend `routineItems`:
```ts
const routineItems = [
  { href: "/routine/connections", label: "בקשות חברות", icon: Search },
  { href: "/routine/job-changes", label: "עדכוני תפקיד", icon: PartyPopper },
  { href: "/routine/company-signals", label: "איתותי חברות", icon: Sparkles },
];
```
Verify the icon import line includes `Sparkles` (add it if missing).

- [ ] **Step 2: Create the review page**

`app/(dashboard)/routine/company-signals/page.tsx`:
```tsx
"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Sparkles, Loader2, ExternalLink, Building2 } from "lucide-react";

type Source = { name: string; url: string; publishedAt: string | null };
type Draft = {
  id: string;
  draftMessage: string;
  createdAt: string;
  contact: { fullName: string; currentTitle: string | null; linkedinUrl: string };
  signal: {
    signalType: string;
    title: string;
    summary: string;
    confidence: number;
    sources: Source[];
    eventDate: string | null;
    company: { name: string };
  };
};

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const TYPE_LABEL: Record<string, string> = {
  FUNDING: "גיוס", HIRING_GROWTH: "צמיחת כוח אדם", OFFICE_MOVE: "מעבר משרד",
  PRODUCT_LAUNCH: "השקת מוצר", AWARD: "פרס", MILESTONE: "אבן דרך", EXEC_HIRE: "מינוי בכיר",
};

export default function CompanySignalsPage() {
  const { data, isLoading } = useSWR<{ drafts: Draft[] }>("/api/company-signals", fetcher, {
    refreshInterval: 30_000,
  });
  const modules = useSWR<{ companySignalsEnabled: boolean }>("/api/routine/modules", fetcher);

  async function toggleModule(enabled: boolean) {
    await fetch("/api/routine/modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module: "companySignals", enabled }),
    });
    mutate("/api/routine/modules");
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-[#f6f5f3]" dir="rtl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e3df] bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#c2410c]" />
          <h1 className="text-lg font-semibold">איתותי חברות — סקירה</h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>מודול פעיל</span>
          <input
            type="checkbox"
            checked={modules.data?.companySignalsEnabled ?? false}
            onChange={(e) => toggleModule(e.target.checked)}
          />
        </label>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-gray-500 p-5">
          <Loader2 className="w-4 h-4 animate-spin" /> טוען…
        </div>
      ) : data.drafts.length === 0 ? (
        <div className="p-5 text-gray-500">אין טיוטות ממתינות לסקירה.</div>
      ) : (
        <div className="flex-1 p-5 flex flex-col gap-4">
          {data.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftCard({ draft }: { draft: Draft }) {
  const [text, setText] = useState(draft.draftMessage);
  const [busy, setBusy] = useState(false);

  async function act(action: "approve" | "dismiss") {
    setBusy(true);
    await fetch(`/api/company-signals/${draft.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "approve" ? { action, message: text } : { action }),
    });
    setBusy(false);
    mutate("/api/company-signals");
  }

  const pct = Math.round(draft.signal.confidence * 100);

  return (
    <div className="bg-white rounded-lg border border-[#e5e3df] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="w-4 h-4 text-gray-500" />
        <span className="font-semibold">{draft.signal.company.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[#fde7d3] text-[#c2410c]">
          {TYPE_LABEL[draft.signal.signalType] ?? draft.signal.signalType}
        </span>
        <span className="text-xs text-gray-500">ביטחון {pct}%</span>
        <span className="text-sm text-gray-700">· {draft.signal.title}</span>
      </div>

      <div className="text-sm text-gray-600">{draft.signal.summary}</div>

      <div className="flex flex-wrap gap-2 text-xs">
        {draft.signal.sources.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[#c2410c] hover:underline">
            <ExternalLink className="w-3 h-3" /> {s.name || new URL(s.url).hostname}
          </a>
        ))}
      </div>

      <div className="text-sm text-gray-700">
        אל: {draft.contact.fullName}{draft.contact.currentTitle ? ` · ${draft.contact.currentTitle}` : ""}
      </div>

      <textarea
        className="w-full min-h-24 rounded-md border border-[#e5e3df] p-2 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="rtl"
      />

      <div className="flex gap-2">
        <button
          disabled={busy || !text.trim()}
          onClick={() => act("approve")}
          className="px-3 py-1.5 rounded-md bg-[#c2410c] text-white text-sm disabled:opacity-50"
        >
          אישור ושליחה
        </button>
        <button
          disabled={busy}
          onClick={() => act("dismiss")}
          className="px-3 py-1.5 rounded-md border border-[#e5e3df] text-sm disabled:opacity-50"
        >
          דחה
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint the new UI**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "company-signals|sidebar" | head`
Expected: no output.
Run: `npx next lint --file "app/(dashboard)/routine/company-signals/page.tsx" 2>&1 | tail -5` (if the repo's lint setup supports `--file`; otherwise `npm run lint` and confirm no new errors in these files).

- [ ] **Step 4: Manual smoke (documented, run if a dev DB is available)**

Run: `npm run dev`, sign in, open `/routine/company-signals`. Toggle the module on. With no drafts you should see "אין טיוטות ממתינות לסקירה." (Seeding a real draft requires the pipeline; covered by unit/integration tests above.)

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/routine/company-signals/page.tsx" components/dashboard/sidebar.tsx
git commit -m "feat(company-signals): sidebar item + review page with sources, confidence, module toggle"
```

---

### Task 13: Environment keys + full-suite green

**Files:**
- Modify: `.env.example` (create if absent) and `.env`

- [ ] **Step 1: Document the new env keys**

Add to `.env.example` (and to your local `.env` with real values when available):
```
# Company Signals — live news sources (all have free tiers)
TAVILY_API_KEY=
SERPER_API_KEY=
GNEWS_API_KEY=
# Optional LLM model override for signal extraction + drafting
COMPANY_SIGNALS_MODEL=anthropic/claude-haiku-4.5
```

- [ ] **Step 2: Run the whole unit+integration suite**

Run: `npx vitest run`
Expected: all suites PASS, including the 7 new files. If any pre-existing suite was already failing before this work, note it but do not fix unrelated failures here.

- [ ] **Step 3: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (Note: `tsconfig.json` excludes `extension/` and `whatsapp-service/` per commit `4adaa1c` — that's fine.)

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore(company-signals): document Tavily/Serper/GNews env keys"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Data sources Tavily+Serper+GNews, graceful degradation → Task 3.
- Verified = 2+ distinct domains OR official source; confidence + sources stored → Task 4 (`computeVerified`) + Task 6 (persist) + Task 12 (display).
- Two models + dedupeKey + `lastSignalCheckAt` + `companySignalsEnabled` + `companySignalDraftId` → Task 1.
- Weekly cron, scope = companies with module-enabled C-level contact, daily cap → Task 8 (tick) + Task 2 (`clevelTitleWhere`).
- detect/draft split; verified-only drafting → Tasks 6, 7, 8.
- LLM extraction (positive-only, no-URL drop, negative filtered) + Hebrew draft; throws without key → Tasks 4, 5.
- Per-owner drafts + "איתותי חברה" list → Task 7.
- Never auto-send; approve → ExtensionTask SEND → SENT; reuse existing path → Tasks 10, 11.
- Routine module + per-org toggle → Task 9 + Task 12.
- Review UI with confidence + source links + editable text → Task 12.
- withTenant + effectiveUserId filtering → Task 10.
- Testing (unit for detect/draft/news; integration for route transitions) → Tasks 2–12.

**Placeholder scan:** none — every code step carries full code; every run step has an expected result.

**Type consistency:** `NewsResult` (Task 3) consumed by Task 4/6; `ExtractedSignal`/`computeVerified`/`makeDedupeKey` (Task 4) consumed by Task 6; `draftCongrats`/`DraftInput` (Task 5) consumed by Task 7; `detectAndRecordSignals` return `{ detected, verifiedNewIds }` (Task 6) consumed by Task 8; `createDraftsForSignal` (Task 7) consumed by Task 8; `companySignalDraftId` (Task 1) used by Tasks 10, 11; module key `"companySignals"` consistent across Tasks 9, 12. Draft status enum `PENDING_REVIEW|APPROVED|SENT|DISMISSED` consistent across Tasks 1, 10, 11, 12.
