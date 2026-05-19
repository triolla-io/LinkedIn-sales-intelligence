# LinkedIn Connections Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync all first-degree LinkedIn connections into the local database automatically, without manual scraping each time.

**Architecture:** Use Patchright (Playwright fork) with a one-time browser login to create a persistent profile. After that, a Python scraper reuses the saved profile to navigate to LinkedIn's connections page, auto-scroll to load every connection, extract structured data, and emit JSON. The Node.js sync function spawns the scraper as a subprocess.

**Tech Stack:** Patchright (browser automation), Python 3.10+, Node.js 24 child_process, BeautifulSoup4 (HTML parsing), Inngest (job orchestration).

**Why this approach:** LinkedIn aggressively blocks programmatic logins (`linkedin-api` got a `ChallengeException`). A real browser session with a persistent profile sidesteps this — LinkedIn sees a normal Chrome with valid cookies and fingerprint, not an API call. The login is human-in-the-loop **once**, then every subsequent sync is automated. The session typically lasts weeks to months before re-login is needed.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/linkedin/connections_scraper.py` | Standalone Python script. Opens Patchright with saved profile, navigates to connections page, scrolls, extracts, prints JSON. |
| `lib/linkedin/extractor.py` | Pure HTML-parsing logic (no browser). Takes raw HTML, returns list of connection dicts. Unit-testable without Playwright. |
| `lib/linkedin/auto_scroll.py` | Pure scroll-strategy logic. Takes a "page snapshot" callable, drives loading until count stops growing. Unit-testable. |
| `lib/linkedin/mcp-client.ts` | Modify: replace `linkedin_worker.py` invocation with `connections_scraper.py` for the `getConnections` path. Keep individual profile/message methods. |
| `inngest/functions/sync-full.ts` | Modify: nothing — already calls `mcp.getConnections()`. |
| `tests/integration/connections-extractor.test.py` | Tests `extractor.py` against fixture HTML files. |
| `tests/fixtures/linkedin-connections-page.html` | Saved real connections page HTML, scrubbed of PII. Used as test input. |
| `.env` | Add `LINKEDIN_PROFILE_DIR` pointing at the stickerdaniel profile path. |
| `README.md` | Add a `## LinkedIn Login Setup` section explaining the one-time `--login` step. |

**Key boundary:** the scraper script is dumb plumbing (open browser, navigate, scroll, dump HTML). The `extractor.py` is the actual logic and is the only file with tests. This is deliberate — Playwright integration tests are slow and flaky; HTML parsing is fast and deterministic.

---

## Task 1: Verify stickerdaniel profile + capture fixture HTML

**Files:**
- Create: `tests/fixtures/linkedin-connections-page.html`

- [ ] **Step 1: Confirm stickerdaniel is installed and ready to login**

Run:
```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --help
```
Expected: prints usage with `--login` flag listed.

- [ ] **Step 2: Run one-time login (user-in-the-loop)**

Run:
```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --login
```
Expected: opens Chrome window. Log in to LinkedIn manually (handle 2FA/captcha). Wait until script confirms session saved. Window closes. Script exits 0.

- [ ] **Step 3: Verify profile directory exists**

Run:
```bash
ls -la ~/.linkedin-mcp/profile/ && ls ~/.linkedin-mcp/
```
Expected: shows `profile/` dir with Chromium-style files (`Cookies`, `Local Storage/`, etc.) and a `cookies.json` or `auth/` directory at the parent.

- [ ] **Step 4: Capture connections-page HTML as test fixture**

Write a one-shot Python script (do not commit) that opens Patchright with the saved profile, navigates to the connections page, scrolls 3 times, and dumps the HTML:

```python
# scratch_capture.py (delete after this task)
import asyncio
from pathlib import Path
from patchright.async_api import async_playwright

async def main():
    profile_dir = Path.home() / ".linkedin-mcp" / "profile"
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(profile_dir), headless=False)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/")
        await page.wait_for_timeout(3000)
        for _ in range(3):
            await page.mouse.wheel(0, 5000)
            await page.wait_for_timeout(1500)
        html = await page.content()
        Path("tests/fixtures/linkedin-connections-page.html").write_text(html)
        await ctx.close()

asyncio.run(main())
```

Run:
```bash
~/.local/bin/uvx --from patchright python scratch_capture.py
```
Expected: produces a `tests/fixtures/linkedin-connections-page.html` file ≥ 500 KB.

- [ ] **Step 5: Scrub PII from fixture**

Open the captured HTML in your editor. Replace the **first two connections'** real names with `Test Person One`, `Test Person Two`. Leave the rest intact (these are real but already scoped to your account). Leave structural HTML/class names untouched. Save.

- [ ] **Step 6: Delete the scratch script and commit the fixture**

```bash
rm scratch_capture.py
git add tests/fixtures/linkedin-connections-page.html
git commit -m "test: capture LinkedIn connections page HTML fixture"
```

---

## Task 2: HTML extractor — failing test first

**Files:**
- Create: `tests/integration/connections-extractor.test.py`
- Create: `lib/linkedin/extractor.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/connections-extractor.test.py`:

```python
from pathlib import Path
import pytest
from lib.linkedin.extractor import extract_connections

FIXTURE = Path(__file__).parent.parent / "fixtures" / "linkedin-connections-page.html"

def test_extracts_all_connections_from_fixture():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    assert len(connections) >= 10, f"Expected at least 10 connections, got {len(connections)}"
    first = connections[0]
    assert first["fullName"], "fullName must be non-empty"
    assert first["profileUrl"].startswith("https://www.linkedin.com/in/"), f"got {first['profileUrl']}"
    assert "urn" in first

def test_extracts_test_person_one_from_scrubbed_fixture():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    names = [c["fullName"] for c in connections]
    assert "Test Person One" in names
    assert "Test Person Two" in names

def test_returns_empty_list_for_empty_html():
    assert extract_connections("<html></html>") == []

def test_handles_missing_headline():
    # Real LinkedIn connections sometimes have no occupation set.
    html = '<li class="mn-connection-card"><a href="/in/someone/"><span class="mn-connection-card__name">Real Person</span></a></li>'
    result = extract_connections(html)
    assert len(result) == 1
    assert result[0]["fullName"] == "Real Person"
    assert result[0]["headline"] == ""
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
~/.local/bin/uvx --from beautifulsoup4 --with pytest python -m pytest tests/integration/connections-extractor.test.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'lib.linkedin.extractor'`.

- [ ] **Step 3: Implement the extractor**

Create `lib/linkedin/extractor.py`:

```python
"""
Pure HTML parser for LinkedIn's /mynetwork/invite-connect/connections/ page.
No browser, no network — takes raw HTML and returns structured dicts.

Two selectors are tried because LinkedIn ships frequent layout changes:
  1. Modern card layout: li.mn-connection-card
  2. Newer entity-result layout: div.scaffold-finite-scroll__content li
The first that yields >0 results wins.
"""

from __future__ import annotations
from typing import Any
from urllib.parse import urlparse
from bs4 import BeautifulSoup


def _public_id_from_url(href: str) -> str:
    """https://www.linkedin.com/in/jane-doe/?...  →  jane-doe"""
    path = urlparse(href).path.rstrip("/")
    parts = path.split("/")
    return parts[-1] if parts and parts[-2] == "in" else ""


def _try_modern_layout(soup: BeautifulSoup) -> list[dict[str, Any]]:
    cards = soup.select("li.mn-connection-card")
    results = []
    for card in cards:
        name_el = card.select_one(".mn-connection-card__name")
        link_el = card.select_one("a[href*='/in/']")
        occ_el = card.select_one(".mn-connection-card__occupation")
        if not name_el or not link_el:
            continue
        href = link_el.get("href", "")
        if href.startswith("/"):
            href = "https://www.linkedin.com" + href
        public_id = _public_id_from_url(href)
        results.append({
            "urn": f"urn:li:fs_miniProfile:{public_id}" if public_id else "",
            "profileUrl": href.split("?")[0],
            "fullName": name_el.get_text(strip=True),
            "headline": occ_el.get_text(strip=True) if occ_el else "",
        })
    return results


def _try_entity_result_layout(soup: BeautifulSoup) -> list[dict[str, Any]]:
    items = soup.select(".scaffold-finite-scroll__content li")
    results = []
    for item in items:
        link_el = item.select_one("a[href*='/in/']")
        if not link_el:
            continue
        href = link_el.get("href", "")
        if href.startswith("/"):
            href = "https://www.linkedin.com" + href
        # Name is usually in a span with aria-hidden, headline in the next sibling block
        name_el = link_el.select_one("span[aria-hidden='true']") or link_el
        name = name_el.get_text(strip=True)
        # Headline: heuristically the second non-empty text block in the item
        text_blocks = [t.strip() for t in item.stripped_strings if t.strip() and t.strip() != name]
        headline = text_blocks[0] if text_blocks else ""
        public_id = _public_id_from_url(href)
        if not name:
            continue
        results.append({
            "urn": f"urn:li:fs_miniProfile:{public_id}" if public_id else "",
            "profileUrl": href.split("?")[0],
            "fullName": name,
            "headline": headline,
        })
    return results


def extract_connections(html: str) -> list[dict[str, Any]]:
    """Parse LinkedIn's connections page HTML. Returns [] if no recognized layout matches."""
    soup = BeautifulSoup(html, "html.parser")
    for strategy in (_try_modern_layout, _try_entity_result_layout):
        results = strategy(soup)
        if results:
            return results
    return []
```

- [ ] **Step 4: Run tests again**

Run:
```bash
~/.local/bin/uvx --from beautifulsoup4 --with pytest python -m pytest tests/integration/connections-extractor.test.py -v
```
Expected: PASS for all 4 tests. If the layout-detection tests fail because the captured fixture uses a different layout than expected, inspect the HTML, identify the correct CSS selector, and update only the strategy that matches your fixture. Do not stub data to make tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/linkedin/extractor.py tests/integration/connections-extractor.test.py
git commit -m "feat: HTML extractor for LinkedIn connections page"
```

---

## Task 3: Auto-scroll logic — failing test first

**Files:**
- Create: `lib/linkedin/auto_scroll.py`
- Create: `tests/integration/auto-scroll.test.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/auto-scroll.test.py`:

```python
import pytest
import asyncio
from lib.linkedin.auto_scroll import scroll_until_stable

class FakePage:
    """Simulates a page where each scroll loads 50 more items, up to 237 total."""
    def __init__(self, total: int = 237, batch: int = 50):
        self.total = total
        self.batch = batch
        self.loaded = batch  # initial load
        self.scrolls = 0

    async def scroll_once(self):
        self.scrolls += 1
        self.loaded = min(self.loaded + self.batch, self.total)

    async def count_items(self) -> int:
        return self.loaded


def test_stops_when_no_new_items_loaded():
    page = FakePage(total=237, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, stable_rounds=2))
    assert page.loaded == 237


def test_respects_max_scrolls():
    # 10000 items / 50 per scroll = 200 scrolls; cap at 5
    page = FakePage(total=10000, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, max_scrolls=5, stable_rounds=2))
    assert page.scrolls == 5


def test_stable_rounds_threshold():
    # If count plateaus for stable_rounds consecutive scrolls, stop
    page = FakePage(total=100, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, stable_rounds=3))
    # 2 scrolls to load 100 items, then 3 more stable scrolls = 5
    assert page.scrolls == 5
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
~/.local/bin/uvx --with pytest python -m pytest tests/integration/auto-scroll.test.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement scroll_until_stable**

Create `lib/linkedin/auto_scroll.py`:

```python
"""
Scroll-driver that loads lazy content until the visible item count
stops growing. Pure logic — accepts callables, not a Page object,
so it can be tested without Playwright.
"""

from __future__ import annotations
from typing import Awaitable, Callable


async def scroll_until_stable(
    scroll_once: Callable[[], Awaitable[None]],
    count_items: Callable[[], Awaitable[int]],
    *,
    max_scrolls: int = 100,
    stable_rounds: int = 3,
) -> int:
    """
    Repeatedly call scroll_once and check count_items. Returns when the count
    has not increased for `stable_rounds` consecutive scrolls, or when
    max_scrolls is hit. Returns the final item count.
    """
    previous = await count_items()
    stable_streak = 0
    for _ in range(max_scrolls):
        await scroll_once()
        current = await count_items()
        if current == previous:
            stable_streak += 1
            if stable_streak >= stable_rounds:
                return current
        else:
            stable_streak = 0
        previous = current
    return previous
```

- [ ] **Step 4: Run tests, verify pass**

Run:
```bash
~/.local/bin/uvx --with pytest python -m pytest tests/integration/auto-scroll.test.py -v
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/linkedin/auto_scroll.py tests/integration/auto-scroll.test.py
git commit -m "feat: scroll-until-stable strategy for lazy-loaded pages"
```

---

## Task 4: Connections scraper subprocess script

**Files:**
- Create: `lib/linkedin/connections_scraper.py`

- [ ] **Step 1: Write the scraper**

Create `lib/linkedin/connections_scraper.py`:

```python
#!/usr/bin/env python3
"""
LinkedIn connections scraper. Uses Patchright (browser automation) with a
previously-saved profile (created via `linkedin-mcp-server --login`).
Prints a single JSON line: {"connections": [...], "error": null}
on success, or {"connections": [], "error": "..."} on failure.

Env:
  LINKEDIN_PROFILE_DIR — path to the saved browser profile directory.
                        Defaults to ~/.linkedin-mcp/profile
"""

from __future__ import annotations
import asyncio
import json
import os
import sys
from pathlib import Path

# We import these lazily inside main() because they aren't available in unit tests.

DEFAULT_PROFILE_DIR = Path.home() / ".linkedin-mcp" / "profile"
CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"


async def scrape() -> dict:
    from patchright.async_api import async_playwright  # type: ignore
    from lib.linkedin.extractor import extract_connections
    from lib.linkedin.auto_scroll import scroll_until_stable

    profile_dir = Path(os.environ.get("LINKEDIN_PROFILE_DIR", str(DEFAULT_PROFILE_DIR))).expanduser()
    if not profile_dir.exists():
        return {"connections": [], "error": f"Profile dir not found: {profile_dir}. Run `linkedin-mcp-server --login` first."}

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(profile_dir),
            headless=True,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(CONNECTIONS_URL, wait_until="domcontentloaded", timeout=30_000)
            # Detect login screen — means profile is stale.
            if "/login" in page.url or "/checkpoint" in page.url:
                return {"connections": [], "error": "LinkedIn session expired. Re-run `linkedin-mcp-server --login`."}

            # Wait for first card to appear before scrolling.
            await page.wait_for_selector(".mn-connection-card, .scaffold-finite-scroll__content", timeout=20_000)

            async def scroll_once():
                await page.mouse.wheel(0, 8000)
                await page.wait_for_timeout(1500)

            async def count_items() -> int:
                return await page.evaluate(
                    "() => document.querySelectorAll('li.mn-connection-card, .scaffold-finite-scroll__content > li').length"
                )

            await scroll_until_stable(scroll_once, count_items, max_scrolls=200, stable_rounds=3)
            html = await page.content()
            connections = extract_connections(html)
            return {"connections": connections, "error": None}
        finally:
            await ctx.close()


def main():
    try:
        result = asyncio.run(scrape())
    except Exception as e:
        result = {"connections": [], "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test the scraper end-to-end**

Make sure you've run `linkedin-mcp-server --login` (Task 1, Step 2). Then run:

```bash
cd ~/linkedin-sales-intelligence && \
  PYTHONPATH=. ~/.local/bin/uvx --from "patchright,beautifulsoup4" python lib/linkedin/connections_scraper.py | python -c "import sys, json; d=json.loads(sys.stdin.read()); print(f'count: {len(d[\"connections\"])}, error: {d[\"error\"]}'); print(d['connections'][:2])"
```

Expected: prints `count: N` where N matches roughly your LinkedIn connection count (within ±10%), error: None, plus the first two connection records. If error is non-null, address that before continuing — common causes: stale session (re-run `--login`), LinkedIn rate-limit (wait 1 hour), missing Chromium (run `~/.local/bin/uvx --from patchright python -m patchright install chromium`).

- [ ] **Step 3: Commit**

```bash
git add lib/linkedin/connections_scraper.py
git commit -m "feat: connections scraper using Patchright persistent profile"
```

---

## Task 5: Wire scraper into Node.js client

**Files:**
- Modify: `lib/linkedin/mcp-client.ts`

- [ ] **Step 1: Read the current `getConnections` implementation**

Run:
```bash
sed -n '120,165p' lib/linkedin/mcp-client.ts
```
Expected: shows the current `getConnections` method that talks to `linkedin_worker.py`. Note it calls `this.call({ cmd: "get_connections" })` which writes to stdin and reads back from stdout.

- [ ] **Step 2: Replace `getConnections` to spawn the new scraper as a one-shot**

The scraper is fundamentally different from the worker: it's not a long-running stdin/stdout loop, it's a one-shot subprocess that prints one JSON line and exits. Update `getConnections` accordingly. Find this block in `lib/linkedin/mcp-client.ts`:

```ts
  async getConnections(opts?: { cursor?: string }): Promise<{ items: RawConnection[]; nextCursor: string | null }> {
    if (this.mockData) {
      const all = this.mockData.connections ?? [];
      const pageSize = 50;
      const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
      const items = all.slice(offset, offset + pageSize);
      const nextCursor = offset + pageSize < all.length ? String(offset + pageSize) : null;
      return { items, nextCursor };
    }

    await this.beforeCall();
    // linkedin-api returns all connections in one call (no cursor pagination)
    const result = await this.call({ cmd: "get_connections", urn: "" }) as { connections: RawConnection[]; nextCursor: null };
    return { items: result.connections ?? [], nextCursor: null };
  }
```

Replace it with:

```ts
  async getConnections(opts?: { cursor?: string }): Promise<{ items: RawConnection[]; nextCursor: string | null }> {
    if (this.mockData) {
      const all = this.mockData.connections ?? [];
      const pageSize = 50;
      const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
      const items = all.slice(offset, offset + pageSize);
      const nextCursor = offset + pageSize < all.length ? String(offset + pageSize) : null;
      return { items, nextCursor };
    }

    // Connections scraper is a one-shot subprocess (different lifecycle than the
    // long-running worker used for profiles/messages), so spawn it separately.
    const { spawn } = await import("child_process");
    const result: { connections: RawConnection[]; error: string | null } = await new Promise((resolve, reject) => {
      const proc = spawn(
        UVX_PATH,
        ["--from", "patchright,beautifulsoup4", "python", "lib/linkedin/connections_scraper.py"],
        {
          cwd: process.cwd(),
          env: { ...process.env, PYTHONPATH: process.cwd() },
        }
      );
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (b) => { stdout += b.toString(); });
      proc.stderr.on("data", (b) => { stderr += b.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`Scraper exited ${code}: ${stderr.slice(0, 500)}`));
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() ?? "{}"));
        } catch (e) {
          reject(new Error(`Scraper produced invalid JSON: ${stdout.slice(0, 500)}`));
        }
      });
      proc.on("error", reject);
    });

    if (result.error) {
      if (isRateLimitError(result.error)) throw new RateLimitError();
      throw new Error(result.error);
    }

    return { items: result.connections ?? [], nextCursor: null };
  }
```

- [ ] **Step 3: TypeScript-check the change**

Run:
```bash
cd ~/linkedin-sales-intelligence && npx tsc --noEmit
```
Expected: no errors in `lib/linkedin/mcp-client.ts`. (Pre-existing errors elsewhere are OK — don't fix unrelated ones in this task.)

- [ ] **Step 4: Commit**

```bash
git add lib/linkedin/mcp-client.ts
git commit -m "feat: spawn Patchright scraper for connections fetch"
```

---

## Task 6: End-to-end manual verification

**Files:** (none modified — verification only)

- [ ] **Step 1: Make sure dev server is running with fresh PATH**

In a terminal:
```bash
cd ~/linkedin-sales-intelligence && source $HOME/.local/bin/env && npm run dev
```
Expected: Ready in <2s on `http://localhost:3001`.

- [ ] **Step 2: Clear stale sync state**

```bash
docker exec $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) psql -U linkedinsi -d linkedinsi -c 'TRUNCATE "Contact", "SyncJob" CASCADE;'
```
Expected: `TRUNCATE TABLE`.

- [ ] **Step 3: Trigger sync from Inngest dashboard**

In a browser, go to `http://localhost:8288`, click **Functions** → `sync-full` → **Invoke**, and submit:
```json
{"data": {"userId": "cmpb5ax640001q6rw150ff8ux"}}
```
Expected: run shows **Running**, then **Completed** within ~30-90s (depends on connection count).

- [ ] **Step 4: Verify contacts loaded**

```bash
docker exec $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) psql -U linkedinsi -d linkedinsi -c 'SELECT count(*) FROM "Contact";'
docker exec $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) psql -U linkedinsi -d linkedinsi -c 'SELECT "fullName", "headline" FROM "Contact" LIMIT 5;'
```
Expected: count > 0 (should roughly match your LinkedIn connection count). Sample rows show real names and headlines.

- [ ] **Step 5: Verify UI**

In a browser, go to `http://localhost:3001/contacts`. Expected: contacts table populated, filter bar usable, insights tiles show counts > 0.

- [ ] **Step 6: Document the one-time login in README**

Add this section to `README.md` (append at the bottom):

```markdown
## LinkedIn Session Setup (one-time)

LinkedIn blocks programmatic logins, so the sync uses a real browser
session that you authenticate once:

```bash
~/.local/bin/uvx --from git+https://github.com/stickerdaniel/linkedin-mcp-server linkedin-mcp-server --login
```

Chrome opens, you sign in (including 2FA/captcha if prompted), then close
the window. The session is saved to `~/.linkedin-mcp/profile/` and reused
by every subsequent sync. Re-run this command when the session expires
(usually after several weeks).
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: explain LinkedIn one-time login setup"
```

---

## Task 7: Hourly delta sync wiring

**Files:**
- Modify: `inngest/functions/sync-delta.ts` (verify already calls `mcp.getConnections()` — same code path)

- [ ] **Step 1: Verify sync-delta uses the same client method**

Run:
```bash
grep -n "getConnections" inngest/functions/sync-delta.ts
```
Expected: at least one match. If the delta function calls `getConnections`, no code change needed — it inherits the scraper automatically.

- [ ] **Step 2: Confirm sync-cron is registered**

Run:
```bash
grep -n "syncCron" app/api/inngest/route.ts
```
Expected: `syncCron` appears in the `functions: [...]` array. If not, add it.

- [ ] **Step 3: Smoke-test delta by triggering it manually**

In Inngest dashboard → `sync-delta` → Invoke with:
```json
{"data": {"userId": "cmpb5ax640001q6rw150ff8ux"}}
```
Expected: completes successfully. Should be **fast** (most contacts already in DB) — re-runs of `getConnections` are not faster on the scraper side, but the `upsert` step is cheap when rows already exist.

- [ ] **Step 4: Commit (if any changes were needed)**

```bash
git diff --quiet || (git add . && git commit -m "feat: ensure delta sync uses Patchright scraper")
```

---

## Self-Review

**Spec coverage:**
- "Get all first-degree connections automatically" — Tasks 1–4 build the scraper, Task 5 wires it in, Task 6 verifies it works end-to-end. ✓
- "Reliable, not blocked by LinkedIn" — Task 1 establishes the persistent-profile approach (sidesteps `ChallengeException` we hit with `linkedin-api`). ✓
- "Automated for ongoing syncs" — Task 7 confirms the hourly cron uses the same code path. ✓

**Placeholder scan:** All steps have actual code/commands. No TODOs. The "scrub PII" step in Task 1 is human-driven by necessity but specifies the exact action (replace the first two names).

**Type consistency:**
- `extract_connections(html: str) -> list[dict]` defined Task 2; called from Task 4. ✓
- `scroll_until_stable(scroll_once, count_items, *, max_scrolls, stable_rounds)` defined Task 3; called from Task 4 with matching args. ✓
- `RawConnection` shape in `mcp-client.ts` already declared; `connections_scraper.py` emits `{urn, profileUrl, fullName, headline}` — matches the type. ✓
- `UVX_PATH` constant referenced in Task 5 is already declared in `mcp-client.ts` (existing code). ✓

**Edge cases covered:**
- Stale session → scraper detects `/login` redirect and returns error message instructing re-login.
- Unrecognized layout → extractor returns `[]` (tested).
- Very long connection list → `max_scrolls=200` cap prevents infinite loop.
- Missing Chromium → smoke test surfaces it with install instructions.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-linkedin-connections-sync.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
