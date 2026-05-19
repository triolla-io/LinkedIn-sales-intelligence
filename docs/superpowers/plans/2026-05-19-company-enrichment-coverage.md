# Company Enrichment Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase company enrichment coverage from the current ~1% (12 of 1,435 contacts) to >70% by (1) running stub-companies for ALL synced contacts, (2) cleaning noisy company name strings before slugifying, and (3) using LinkedIn's company typeahead search to resolve names to the correct `universalName` instead of brittle direct slug lookup.

**Architecture:** Three-layer fix. **Layer 1**: `cleanCompanyName()` utility strips emojis, RTL marks, parenthetical suffixes, and headline-tail noise ("| Innovation Architect | …"). **Layer 2**: `voyager_companies.py` first hits LinkedIn's typeahead endpoint (`/voyager/api/typeahead/hitsV2`) to resolve `name → universalName`, then hits the existing organization endpoint to get `staffCount` + `industries`. **Layer 3**: A new Inngest event `companies.rebuild` walks every Contact with a `currentCompany` string but no `companyId`, stubs the Company row, links it, and emits enrichment.

**Tech Stack:** Next.js 16, Prisma 7, Inngest 4, Patchright + Python for Voyager subprocess, Postgres 5433, Vitest + pytest.

**Working directory:** `~/linkedin-sales-intelligence`

---

## Diagnosis Summary (do not re-derive)

**Current DB state (after the 1,435-contact sync):**
- `Contact`: 1,435 rows, of which 742 have a non-null `currentCompany` string
- `Company`: 12 rows (all created at 2026-05-19 11:21 during the first 30-contact sync)
- `Contact.companyId IS NOT NULL`: only 12
- `Company.staffCount IS NOT NULL`: only 8
- `SELECT count(DISTINCT "currentCompany") FROM "Contact" WHERE "currentCompany" IS NOT NULL` → **553**

**What's broken:**
1. The `stub-companies` Inngest step (in `inngest/functions/sync-full.ts`) ran for the first 30-contact sync but did NOT create new rows during the 1,435-contact sync. Either it errored silently or the dev server was running stale compiled code. The step needs to be exercised again — explicitly — for the existing data.
2. Even when it ran, the slug-based lookup against LinkedIn's `universalName` endpoint fails for ~90% of real company names because:
   - Hebrew company names like `"‏Bet Shemesh Engines Ltd.‏"` → slug is `"bet-shemesh-engines-ltd"`, but LinkedIn's actual `universalName` is something else
   - Emojis in names (`"Evinced🩷💜💙"`, `"Shenkar 🎓"`) slugify to clean slugs that *might* match — but only by luck
   - Headlines like `"iLands.io l Innovation Architect l Strategic Advisor for Startups"` get stored as the whole `currentCompany` because the headline parser doesn't strip the suffix
3. The Voyager `?q=universalName&universalName={slug}` endpoint returns 200 with empty `included` when the slug doesn't match — we silently skip those companies.

**The fix:** clean the name, then use typeahead search (`/voyager/api/typeahead/hitsV2?...&q=type&queryContext=List(typeaheadFilterValues:List(resultType->COMPANY))`) to get the correct `universalName`, then call the org endpoint with that real `universalName`.

---

## File Structure

### New files
- `lib/linkedin/clean-company-name.ts` — pure utility: strips emojis, RTL marks, parenthetical suffixes, and `" | extra text"` tails from raw `currentCompany` strings. Used by `sync-full.ts` and `voyager_companies.py` (via JSON over stdin so we only implement once).
- `tests/unit/clean-company-name.test.ts` — Vitest unit tests against real DB samples.
- `inngest/functions/rebuild-companies.ts` — Inngest function on event `companies.rebuild { userId }`. Walks all `Contact` rows for the user, runs the same stub/link/enrich logic as `sync-full.ts` but is idempotent and re-runnable.
- `tests/integration/voyager-typeahead.test.py` — pytest against a captured fixture confirming the typeahead response shape.
- `scripts/trigger-rebuild.ts` — a one-line script (`tsx scripts/trigger-rebuild.ts`) that fires the `companies.rebuild` event for the current user. Avoids needing to use the Inngest dev UI.

### Modified
- `lib/linkedin/voyager_companies.py` — read slugs from stdin, but first call typeahead to resolve `name → universalName`, fall back to direct slug if typeahead returns no hits.
- `inngest/functions/sync-full.ts` — call `cleanCompanyName()` before slugifying inside the `stub-companies` and `link-contacts-to-companies` steps. Add `await step.sendEvent("companies.enrich" ...)` retry-safe even when `companySlugs.length === 0` (so we never silently skip).
- `app/api/inngest/route.ts` — register `rebuildCompanies` in the `functions` array.

### Untouched
- `lib/linkedin/slug-utils.ts` — `slugifyCompany` stays as-is. The new layer is `cleanCompanyName` → `slugifyCompany`.
- `prisma/schema.prisma` — DB shape is fine; we're just populating more rows.

---

## Task 0: Spike — verify typeahead endpoint returns company hits

**Files:**
- Create: `scripts/voyager-spike/probe-typeahead.py`
- Create: `tests/fixtures/voyager-typeahead-sample.json` (committed after spike)

- [ ] **Step 1: Kill stale Chrome before spike**

```bash
pkill -f "linkedin-mcp/profile" 2>/dev/null; sleep 2
```

- [ ] **Step 2: Write the typeahead probe**

Create `scripts/voyager-spike/probe-typeahead.py`:

```python
"""Probe LinkedIn's typeahead/hitsV2 endpoint for company name → universalName resolution."""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
BASE = "https://www.linkedin.com/voyager/api"
SAMPLES = ["Mobileye", "Microsoft", "Bet Shemesh Engines Ltd.", "Evinced", "Tomorrow.io"]


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(1500)
        if "/login" in page.url:
            print("NOT LOGGED IN"); await ctx.close(); return

        cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
        jsess = cookies.get("JSESSIONID", "").strip('"')
        headers = {
            "csrf-token": jsess,
            "x-restli-protocol-version": "2.0.0",
            "accept": "application/vnd.linkedin.normalized+json+2.1",
            "x-li-lang": "en_US",
        }

        for name in SAMPLES:
            r = await ctx.request.get(
                f"{BASE}/typeahead/hitsV2",
                params={
                    "keywords": name,
                    "origin": "OTHER",
                    "q": "type",
                    "queryContext": "List(typeaheadFilterValues:List(resultType->COMPANY))",
                    "count": "3",
                },
                headers=headers,
            )
            body = await r.text()
            print(f"\n=== {name!r} → status {r.status} ===")
            if r.status != 200:
                print("Body:", body[:300])
                continue

            data = json.loads(body)
            print("data keys:", list(data.get("data", {}).keys())[:8])
            elements = data.get("data", {}).get("*elements") or data.get("data", {}).get("elements") or []
            included = data.get("included", [])
            print(f"  elements/refs: {len(elements)}, included: {len(included)}")
            for inc in included[:3]:
                if "Company" in inc.get("$type", "") or "Organization" in inc.get("$type", ""):
                    print(f"  → name={inc.get('name')!r} universalName={inc.get('universalName')!r}")

            if name == "Mobileye":
                Path("tests/fixtures/voyager-typeahead-sample.json").write_text(body)
                print("  saved fixture for Mobileye")

        await ctx.close()


asyncio.run(main())
```

- [ ] **Step 3: Run the spike**

Run:
```bash
cd ~/linkedin-sales-intelligence
~/.local/bin/uv run --with patchright python scripts/voyager-spike/probe-typeahead.py 2>&1 | grep -v "^$" | tail -40
```

Expected: each sample prints `status 200`, and the included array contains a Company or Organization with `universalName` populated (e.g., Mobileye → `"mobileye"`, Microsoft → `"microsoft"`).

If status is 404 or no companies in `included`, try alternate endpoints:
- `/typeahead/hits?keywords=...&type=COMPANY&q=federated` (older)
- `/voyagerOrganizationDashCompanySearchByKeywords?keywords=...&count=5` (newer)

Capture which one works.

- [ ] **Step 4: Document the response shape**

After confirming the working endpoint, create `tests/fixtures/voyager-typeahead-shape.md` with:
- Endpoint path that worked
- Path to the company list in the response (e.g., `included[*]` filtered by `$type`)
- The field path for `universalName`
- Field path for the canonical company name

- [ ] **Step 5: Commit the fixture**

```bash
cd ~/linkedin-sales-intelligence
git add scripts/voyager-spike/probe-typeahead.py tests/fixtures/voyager-typeahead-sample.json tests/fixtures/voyager-typeahead-shape.md
git commit -m "spike(voyager): validate company typeahead endpoint and capture fixture"
```

**Gate:** Do not start Task 1 until typeahead is confirmed to return `universalName` for at least 3 of 5 sample names.

---

## Task 1: `cleanCompanyName` utility (TDD)

**Files:**
- Create: `lib/linkedin/clean-company-name.ts`
- Test: `tests/unit/clean-company-name.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/clean-company-name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cleanCompanyName } from "@/lib/linkedin/clean-company-name";

describe("cleanCompanyName", () => {
  it.each([
    // Plain names — pass through unchanged
    ["Microsoft", "Microsoft"],
    ["Google", "Google"],
    // Strip emojis
    ["Evinced🩷💜💙", "Evinced"],
    ["Shenkar 🎓", "Shenkar"],
    ["The Hebrew University ✭I'm Hiring✭", "The Hebrew University"],
    // Strip Hebrew RTL marks (U+200E, U+200F)
    ["‏Bet Shemesh Engines Ltd.‏", "Bet Shemesh Engines Ltd."],
    // Strip trailing " | …" or " l …" suffix (job description tail)
    ["iLands.io l Innovation Architect l Strategic Advisor", "iLands.io"],
    ["Nvidia l Electrical Engineer Student", "Nvidia"],
    ["Dor Duchovni | Head of R&D at Artlist.io", "Dor Duchovni"],
    // Strip parentheticals
    ["Amazon (AWS)", "Amazon"],
    // Strip "I'm Hiring" markers
    ["GotFriends ⭐I'm Hiring⭐", "GotFriends"],
    // Trim whitespace
    ["  Microsoft  ", "Microsoft"],
    // Empty / nullish
    ["", ""],
  ])("cleans %j → %j", (input, expected) => {
    expect(cleanCompanyName(input)).toBe(expected);
  });

  it("handles null", () => {
    expect(cleanCompanyName(null)).toBe("");
  });

  it("handles undefined", () => {
    expect(cleanCompanyName(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/linkedin-sales-intelligence
npx vitest run tests/unit/clean-company-name.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '@/lib/linkedin/clean-company-name'`.

- [ ] **Step 3: Implement the utility**

Create `lib/linkedin/clean-company-name.ts`:

```ts
/**
 * Normalize raw company-name strings extracted from LinkedIn connection cards.
 *
 * Inputs are noisy — emojis, RTL marks, "I'm Hiring" tags, parentheticals,
 * and headline-tail descriptions ("Company | Senior Engineer | …").
 * Output is what we'd want to display AND use as input to LinkedIn's company
 * typeahead API.
 */
export function cleanCompanyName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw;

  // Strip RTL/LTR marks (U+200E, U+200F, U+202A-U+202E)
  s = s.replace(/[‎‏‪-‮]/g, "");

  // Strip emojis and pictographs (covers most LinkedIn flair)
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu,
    "",
  );

  // Strip parentheticals: "Amazon (AWS)" → "Amazon"
  s = s.replace(/\s*\([^)]*\)\s*/g, " ");

  // Strip "I'm Hiring" markers and similar (case-insensitive)
  s = s.replace(/\b(I['']?m\s+Hiring|We['']?re\s+Hiring|Hiring!?)\b/gi, "");

  // Cut at first " | " or " l " separator (headline-tail noise)
  //   "iLands.io l Innovation Architect" → "iLands.io"
  //   "Foo | Bar | Baz" → "Foo"
  // Use word-boundary " l " to avoid clipping legit words.
  s = s.split(/\s+[|l]\s+/)[0] ?? s;

  // Collapse internal whitespace, then trim
  return s.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/clean-company-name.test.ts 2>&1 | tail -10
```

Expected: all 16 test cases pass.

- [ ] **Step 5: Commit**

```bash
git add lib/linkedin/clean-company-name.ts tests/unit/clean-company-name.test.ts
git commit -m "feat(linkedin): add cleanCompanyName utility to strip noise before slugifying"
```

---

## Task 2: Wire `cleanCompanyName` into `sync-full.ts`

**Files:**
- Modify: `inngest/functions/sync-full.ts`

- [ ] **Step 1: Add the import**

At the top of `inngest/functions/sync-full.ts`, after the existing `slugifyCompany` import, add:

```ts
import { cleanCompanyName } from "@/lib/linkedin/clean-company-name";
```

- [ ] **Step 2: Apply `cleanCompanyName` in the `stub-companies` step**

Find the `stub-companies` `step.run` block and replace its body. The current version is:

```ts
const bySlug = new Map<string, string>();
for (const c of synced) {
  if (!c.currentCompany) continue;
  const slug = slugifyCompany(c.currentCompany);
  if (slug) bySlug.set(slug, c.currentCompany);
}
```

Replace with:

```ts
const bySlug = new Map<string, string>();
for (const c of synced) {
  const cleaned = cleanCompanyName(c.currentCompany);
  if (!cleaned) continue;
  const slug = slugifyCompany(cleaned);
  if (slug) bySlug.set(slug, cleaned);
}
```

- [ ] **Step 3: Apply the same in `link-contacts-to-companies`**

In the `link-contacts-to-companies` step, replace:

```ts
for (const contact of synced) {
  if (!contact.currentCompany) continue;
  const slug = slugifyCompany(contact.currentCompany);
  ...
}
```

with:

```ts
for (const contact of synced) {
  const cleaned = cleanCompanyName(contact.currentCompany);
  if (!cleaned) continue;
  const slug = slugifyCompany(cleaned);
  ...
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "sync-full" | head -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add inngest/functions/sync-full.ts
git commit -m "fix(sync-full): clean company names before slugifying so noisy strings produce valid slugs"
```

---

## Task 3: Update `voyager_companies.py` to use typeahead first

**Files:**
- Modify: `lib/linkedin/voyager_companies.py`
- Test: `tests/unit/test_voyager_companies_parser.py` (already exists; extend it)

**Important:** Use the exact endpoint + response paths discovered in Task 0's spike. The skeleton below assumes typeahead returns companies in `included[]` with `$type` containing `"Company"` and a `universalName` field. Adjust if the spike found a different path.

- [ ] **Step 1: Read the current `voyager_companies.py`**

Run: `cat ~/linkedin-sales-intelligence/lib/linkedin/voyager_companies.py`

Confirm the existing `_parse_company(slug, raw)` function reads from `included[*]` where `$type` contains `"Company"`. We'll add a `_resolve_universal_name(session, name)` helper that calls typeahead first.

- [ ] **Step 2: Add the typeahead resolver**

Open `lib/linkedin/voyager_companies.py`. Replace the entire file with:

```python
"""One-shot subprocess: read JSON array of company display names from stdin,
resolve each to a LinkedIn universalName via typeahead, then fetch full company
data (staffCount + industries) via the organization endpoint.

Output (single JSON line):
  {"companies": [...], "error": null}
  {"companies": [], "error": "SESSION_EXPIRED: ..."}
"""
from __future__ import annotations
import asyncio
import json
import sys
from typing import Any

import aiohttp

from lib.linkedin.voyager_client import (
    RateLimitError,
    SessionExpiredError,
    voyager_get,
)

CONCURRENCY = 3
ORG_PATH = "/organization/companies"
TYPEAHEAD_PATH = "/typeahead/hitsV2"


async def _resolve_universal_name(
    session: aiohttp.ClientSession, display_name: str
) -> str | None:
    """Use typeahead to find the LinkedIn universalName for a company by its display name."""
    raw = await voyager_get(
        session,
        TYPEAHEAD_PATH,
        {
            "keywords": display_name,
            "origin": "OTHER",
            "q": "type",
            "queryContext": "List(typeaheadFilterValues:List(resultType->COMPANY))",
            "count": 3,
        },
    )
    for inc in raw.get("included", []):
        if "Company" in inc.get("$type", "") or "Organization" in inc.get("$type", ""):
            uname = inc.get("universalName")
            if uname:
                return uname
    return None


def _parse_company(name_or_slug: str, raw: dict[str, Any]) -> dict[str, Any] | None:
    incl = raw.get("included", [])
    company = next(
        (
            x
            for x in incl
            if "Company" in x.get("$type", "") or "Organization" in x.get("$type", "")
        ),
        None,
    )
    if not company:
        return None
    industries: list[str] = company.get("industries") or []
    if industries and industries[0].startswith("urn:"):
        resolved = [x.get("localizedName") for x in incl if "Industry" in x.get("$type", "")]
        industries = [r for r in resolved if r]
    return {
        "universalName": company.get("universalName") or name_or_slug,
        "name": company.get("name") or "",
        "industry": industries[0] if industries else None,
        "industries": industries,
        "staffCount": company.get("staffCount"),
        "website": company.get("companyPageUrl"),
        "description": company.get("description"),
    }


async def _enrich_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    display_name: str,
) -> dict[str, Any] | None:
    """Resolve display_name → universalName → full company data. Returns None if not found."""
    async with sem:
        # Step 1: typeahead to get the real universalName
        uname = await _resolve_universal_name(session, display_name)
        if not uname:
            return None
        # Step 2: fetch full company data
        raw = await voyager_get(
            session, ORG_PATH, {"q": "universalName", "universalName": uname}
        )
    return _parse_company(uname, raw)


async def run(names: list[str]) -> dict[str, Any]:
    sem = asyncio.Semaphore(CONCURRENCY)
    timeout = aiohttp.ClientTimeout(total=900)
    companies: list[dict] = []
    async with aiohttp.ClientSession(timeout=timeout) as session:
        tasks = [_enrich_one(session, sem, name) for name in names]
        for result in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(result, Exception):
                sys.stderr.write(f"fetch failed: {result}\n")
            elif result:
                companies.append(result)
    return {"companies": companies, "error": None}


def main() -> int:
    raw_in = sys.stdin.read().strip()
    try:
        names = json.loads(raw_in)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"companies": [], "error": f"Invalid JSON input: {e}"}))
        return 1
    if not isinstance(names, list):
        sys.stdout.write(json.dumps({"companies": [], "error": "stdin must be JSON array of strings"}))
        return 1
    try:
        result = asyncio.run(run(names))
    except SessionExpiredError as e:
        result = {"companies": [], "error": f"SESSION_EXPIRED: {e}"}
    except RateLimitError as e:
        result = {"companies": [], "error": f"RATE_LIMITED: {e}"}
    except Exception as e:  # noqa: BLE001
        result = {"companies": [], "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")
    return 0 if result["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
```

The key behavioral change: **input is display names, not slugs.** The script does the typeahead step itself so callers don't have to think about LinkedIn's universalName scheme.

- [ ] **Step 3: Update the existing unit test to match**

The unit test in `tests/unit/test_voyager_companies_parser.py` tests `_parse_company(slug, fixture)`. The signature is now `_parse_company(name_or_slug, raw)` — same shape, just different name. Tests should still pass without changes.

Run:
```bash
~/.local/bin/uv run --with pytest --with aiohttp pytest tests/unit/test_voyager_companies_parser.py -v 2>&1 | tail -10
```

Expected: 2/2 pass.

- [ ] **Step 4: Integration smoke test**

```bash
cd ~/linkedin-sales-intelligence
pkill -f "linkedin-mcp/profile" 2>/dev/null; sleep 2
echo '["Microsoft","Mobileye","Bet Shemesh Engines Ltd.","Evinced"]' | \
  PYTHONPATH=. ~/.local/bin/uv run --with aiohttp --with patchright \
  python lib/linkedin/voyager_companies.py 2>&1 | tail -5
```

Expected: at least 3 of the 4 names return company records with `staffCount` and `industry` populated.

- [ ] **Step 5: Commit**

```bash
git add lib/linkedin/voyager_companies.py
git commit -m "feat(voyager_companies): resolve display name → universalName via typeahead before fetching"
```

---

## Task 4: Update `enrich-companies` Inngest function — accept display names, not slugs

**Files:**
- Modify: `inngest/functions/enrich-companies.ts`

The function currently expects an event with `data: { slugs: string[] }`. Now we send `data: { names: string[] }` (display names — the typeahead resolves to slugs server-side).

- [ ] **Step 1: Read the existing function**

```bash
cat ~/linkedin-sales-intelligence/inngest/functions/enrich-companies.ts
```

- [ ] **Step 2: Rename payload field from `slugs` to `names`**

In `inngest/functions/enrich-companies.ts`, change:

```ts
const requestedSlugs: string[] = event.data.slugs ?? [];

const toEnrich = await step.run("find-companies-needing-enrichment", async () => {
  const rows = await prisma.company.findMany({
    where: {
      universalName: { in: requestedSlugs },
      staffCount: null,
    },
    select: { universalName: true },
  });
  return rows.map((r: { universalName: string }) => r.universalName);
});
```

to:

```ts
const requestedNames: string[] = event.data.names ?? [];
if (requestedNames.length === 0) return { enriched: 0, skipped: 0 };

const fetched = await step.run("fetch-from-voyager", () => runScraper(requestedNames));
```

**And remove the `find-companies-needing-enrichment` step entirely.** The `voyager_companies.py` script now handles the typeahead → universalName resolution; we can't pre-filter by universalName because the inputs are raw names.

- [ ] **Step 3: Update the upsert step to upsert by universalName**

The `upsert-companies` step currently runs `prisma.company.update(...)`. Change it to `prisma.company.upsert(...)` because the row may not exist yet (we're using typeahead to discover new universalNames):

```ts
const enriched = await step.run("upsert-companies", async () => {
  let count = 0;
  for (const c of fetched) {
    await prisma.company.upsert({
      where: { universalName: c.universalName },
      create: {
        universalName: c.universalName,
        name: c.name || c.universalName,
        industry: c.industry,
        staffCount: c.staffCount,
        website: c.website,
        description: c.description,
        lastEnrichedAt: new Date(),
      },
      update: {
        name: c.name || undefined,
        industry: c.industry,
        staffCount: c.staffCount,
        website: c.website,
        description: c.description,
        lastEnrichedAt: new Date(),
      },
    });
    count++;
  }
  return count;
});

return { enriched, requested: requestedNames.length };
```

- [ ] **Step 4: Update `sync-full.ts` event emit to send `names` instead of `slugs`**

In `inngest/functions/sync-full.ts`, find the `emit-companies-enrich` step. Change:

```ts
await step.sendEvent("emit-companies-enrich", {
  name: "companies.enrich" as const,
  data: { slugs: companySlugs },
});
```

to:

```ts
// Send raw display names; enrich-companies handles typeahead resolution
const companyNames = [...new Set(
  (await prisma.contact.findMany({
    where: { ownerId: userId, linkedinUrn: { in: newUrns }, currentCompany: { not: null } },
    select: { currentCompany: true },
  })).map((c: { currentCompany: string | null }) => cleanCompanyName(c.currentCompany)).filter(Boolean)
)];

if (companyNames.length > 0) {
  await step.sendEvent("emit-companies-enrich", {
    name: "companies.enrich" as const,
    data: { names: companyNames },
  });
}
```

- [ ] **Step 5: Type-check**

```bash
cd ~/linkedin-sales-intelligence
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -10
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add inngest/functions/enrich-companies.ts inngest/functions/sync-full.ts
git commit -m "feat(enrich-companies): accept display names; upsert by universalName"
```

---

## Task 5: New Inngest function `rebuild-companies` (idempotent retroactive enrichment)

**Files:**
- Create: `inngest/functions/rebuild-companies.ts`
- Modify: `app/api/inngest/route.ts`

This function exists so we can re-process the existing 1,435 contacts without re-running the LinkedIn DOM scrape. It walks every contact, cleans + slugifies, stubs Company rows, links `Contact.companyId`, then emits one `companies.enrich` event for all the names.

- [ ] **Step 1: Implement `rebuild-companies.ts`**

Create `inngest/functions/rebuild-companies.ts`:

```ts
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { slugifyCompany } from "@/lib/linkedin/slug-utils";
import { cleanCompanyName } from "@/lib/linkedin/clean-company-name";

export const rebuildCompanies = inngest.createFunction(
  {
    id: "rebuild-companies",
    name: "Rebuild Company rows and links for an existing user",
    concurrency: { limit: 1 },
    retries: 1,
    triggers: [{ event: "companies.rebuild" as const }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: any) => {
    const { userId } = event.data as { userId: string };

    // Step 1: load every contact with a currentCompany string
    const contacts = await step.run("load-contacts", () =>
      prisma.contact.findMany({
        where: { ownerId: userId, currentCompany: { not: null } },
        select: { id: true, currentCompany: true },
      }),
    );

    // Step 2: build (slug → cleaned name) map
    const bySlug = new Map<string, string>();
    const contactToSlug = new Map<string, string>();  // contactId → slug
    for (const c of contacts as { id: string; currentCompany: string }[]) {
      const cleaned = cleanCompanyName(c.currentCompany);
      if (!cleaned) continue;
      const slug = slugifyCompany(cleaned);
      if (!slug) continue;
      bySlug.set(slug, cleaned);
      contactToSlug.set(c.id, slug);
    }

    if (bySlug.size === 0) return { stubs: 0, linked: 0, requested_enrichment: 0 };

    // Step 3: upsert Company stubs
    await step.run("upsert-stubs", async () => {
      // Chunk to avoid massive single transactions
      const entries = [...bySlug.entries()];
      const CHUNK = 100;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK);
        await prisma.$transaction(
          chunk.map(([slug, name]) =>
            prisma.company.upsert({
              where: { universalName: slug },
              update: {},
              create: { universalName: slug, name },
            }),
          ),
        );
      }
      return entries.length;
    });

    // Step 4: link contacts to companies
    const linked = await step.run("link-contacts", async () => {
      const companies = await prisma.company.findMany({
        where: { universalName: { in: [...bySlug.keys()] } },
        select: { id: true, universalName: true },
      });
      const idBySlug = new Map(
        companies.map((r: { id: string; universalName: string }) => [r.universalName, r.id]),
      );
      let count = 0;
      for (const [contactId, slug] of contactToSlug) {
        const companyId = idBySlug.get(slug);
        if (!companyId) continue;
        await prisma.contact.update({
          where: { id: contactId },
          data: { companyId },
        });
        count++;
      }
      return count;
    });

    // Step 5: emit one enrichment event with the deduped cleaned names
    const names = [...bySlug.values()];
    await step.sendEvent("emit-companies-enrich", {
      name: "companies.enrich" as const,
      data: { names },
    });

    return { stubs: bySlug.size, linked, requested_enrichment: names.length };
  },
);
```

- [ ] **Step 2: Register the function in `app/api/inngest/route.ts`**

In `app/api/inngest/route.ts`, add the import:

```ts
import { rebuildCompanies } from "@/inngest/functions/rebuild-companies";
```

And add `rebuildCompanies` to the `functions: [...]` array in the `serve(...)` call.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -v "node_modules" | head -10
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add inngest/functions/rebuild-companies.ts app/api/inngest/route.ts
git commit -m "feat(inngest): add rebuild-companies for idempotent retroactive enrichment"
```

---

## Task 6: Trigger script

**Files:**
- Create: `scripts/trigger-rebuild.ts`

- [ ] **Step 1: Implement the script**

Create `scripts/trigger-rebuild.ts`:

```ts
/**
 * Trigger companies.rebuild for the first User in the DB.
 * Usage: npx tsx scripts/trigger-rebuild.ts
 */
import { prisma } from "../lib/prisma";
import { inngest } from "../inngest/client";

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) {
    console.error("No User row found");
    process.exit(1);
  }
  console.log(`Triggering companies.rebuild for ${user.email} (${user.id})`);
  await inngest.send({
    name: "companies.rebuild",
    data: { userId: user.id },
  });
  console.log("Event sent. Watch the Inngest dev UI at http://localhost:8288.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Test the script**

Make sure both `npm run dev` and `npx inngest-cli@latest dev` are running, then:

```bash
cd ~/linkedin-sales-intelligence
npx tsx scripts/trigger-rebuild.ts
```

Expected: prints "Triggering companies.rebuild for ...", then "Event sent." The Inngest dev UI shows the `rebuild-companies` function running, and 1-2 minutes later it completes with a result like `{ stubs: 400+, linked: 400+, requested_enrichment: 400+ }`. The follow-up `enrich-companies` function then runs (slower — 5-15 minutes — because each name needs a typeahead + org endpoint call).

- [ ] **Step 3: Commit**

```bash
git add scripts/trigger-rebuild.ts
git commit -m "chore: add trigger-rebuild script to fire companies.rebuild"
```

---

## Task 7: Run the rebuild on the current data and verify

This task is operational — no new files. Execute and verify.

- [ ] **Step 1: Ensure servers are running**

In separate terminals:
```bash
# Terminal A
cd ~/linkedin-sales-intelligence && npm run dev

# Terminal B
cd ~/linkedin-sales-intelligence && npx inngest-cli@latest dev
```

- [ ] **Step 2: Confirm LinkedIn session is alive (no stale Chrome)**

```bash
pkill -f "linkedin-mcp/profile" 2>/dev/null; sleep 1
```

- [ ] **Step 3: Trigger the rebuild**

```bash
cd ~/linkedin-sales-intelligence
npx tsx scripts/trigger-rebuild.ts
```

- [ ] **Step 4: Watch `rebuild-companies` finish**

In the Inngest dev UI at `http://localhost:8288`, wait for `rebuild-companies` to complete. The return value should be approximately:
- `stubs`: 400-550 (depending on how many cleaned names produced valid slugs)
- `linked`: similar number
- `requested_enrichment`: similar number

Confirm via SQL:

```bash
cd ~/linkedin-sales-intelligence
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT count(*) FROM "Company"; SELECT count(*) FROM "Contact" WHERE "companyId" IS NOT NULL;'
```

Expected: `Company` count jumps from 12 to 400+. `Contact.companyId` count jumps from 12 to 700+.

- [ ] **Step 5: Watch `enrich-companies` complete**

This runs after the rebuild. It calls typeahead + org-fetch for each unique name. For ~500 names at ~600ms per name with concurrency 3, expect 5-15 minutes.

When complete, verify:

```bash
docker compose exec -T postgres psql -U linkedinsi linkedinsi -c \
  'SELECT count(*) FROM "Company" WHERE "staffCount" IS NOT NULL;
   SELECT count(*) FROM "Company" WHERE "industry" IS NOT NULL;
   SELECT name, industry, "staffCount" FROM "Company"
   WHERE "staffCount" BETWEEN 30 AND 500 ORDER BY "staffCount" LIMIT 10;'
```

Expected: `staffCount IS NOT NULL` count ≥ 200 (i.e., > 40% of Company rows successfully enriched). The filter "30-500 employees" should return at least 20 named companies with industries.

- [ ] **Step 6: UI verification**

Open `http://localhost:3000/contacts`, apply filters: `seniority = C-Level`, `employees 30-500`, `industry = Software Development` (or similar industry visible in the data).

Expected: the table returns ≥ 10 rows with name, title, company, employees, and industry all populated.

---

## Verification

The work is complete when:

- [ ] `npx vitest run tests/unit/clean-company-name.test.ts` — 16/16 pass
- [ ] `npx tsc --noEmit` — clean
- [ ] `Company` row count is ≥ 400 (up from 12)
- [ ] `Company.staffCount IS NOT NULL` count is ≥ 200 (up from 8)
- [ ] `Contact.companyId IS NOT NULL` count is ≥ 700 (up from 12)
- [ ] UI filter "C-Level + 30-500 employees" returns ≥ 10 rows with all columns populated

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Task 0 spike finds the typeahead endpoint also returns 404 or empty | Try the alternate endpoint paths listed in Task 0 Step 3. If none work, fall back to `voyagerOrganizationDashCompanySearchByKeywords`. If that also fails, plan stops at Task 2 — we still get the cleaned-name fix and improved slug coverage from `sync-full.ts` even without typeahead. |
| Rate limit on typeahead at 553 calls | `voyager_companies.py` already uses CONCURRENCY=3 with jittered delays. If 429 appears, drop concurrency to 1 (single-line edit). |
| LinkedIn session expires mid-rebuild | `voyager_companies.py` raises `SessionExpiredError` on 401 → Inngest function fails the run with a clear error. User clicks "Connect LinkedIn" in the app to re-auth, then re-runs `npx tsx scripts/trigger-rebuild.ts`. |
| Slug collision: two different cleaned names map to the same slug | `prisma.company.upsert` with `where: { universalName: slug }` collapses them into one Company row. The second contact ends up linked to the first one's company — acceptable for now. |
| `prisma.$transaction` with hundreds of upserts is slow | Task 5 Step 1 already chunks into batches of 100. |
| The dev server was running stale code during the 1,435 sync (the original bug) | Task 7 Step 1 explicitly restarts both servers. Also, the rebuild is idempotent — running it again is safe. |

---

## Open Questions

1. **Should we drop the 12 already-stubbed Company rows before rebuild?** No. The upsert handles duplicates correctly, and the 8 already-enriched companies should be preserved.
2. **What about contacts whose `currentCompany` is null (693 of them)?** Out of scope. They have no signal at all from the connections-page DOM. The profile-enrich job covers them in the background (slow, ~1-2 hours for 693 contacts).
3. **Should the cleaned name also be saved on the Contact?** Not in this plan. `Contact.currentCompany` keeps the raw value for display fidelity; the cleaning is only used as an input to the lookup pipeline.
