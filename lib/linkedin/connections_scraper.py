#!/usr/bin/env python3
"""
LinkedIn connections scraper. Uses Patchright with a profile saved via
`linkedin-mcp-server --login`. Prints a single JSON line to stdout:
  {"connections": [...], "error": null}    on success
  {"connections": [], "error": "..."}      on failure

Env:
  LINKEDIN_PROFILE_DIR — path to the saved browser profile directory.
                         Defaults to ~/.linkedin-mcp/profile

LinkedIn uses virtual scrolling — cards enter and leave the DOM as the user
scrolls. We:
  1. Click the page to give focus, then press End to scroll
  2. Extract the currently-visible cards after each scroll step
  3. Accumulate into a deduped set by profile URL
  4. Stop after MAX_STABLE_ROUNDS consecutive rounds with no new profiles
"""

from __future__ import annotations
import asyncio
import json
import os
import subprocess
from pathlib import Path

DEFAULT_PROFILE_DIR = Path.home() / ".linkedin-mcp" / "profile"
CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"
CARD_SELECTOR = "a[data-view-name='connections-profile']"
MAX_STABLE_ROUNDS = 8
MAX_SCROLLS = 1000


def _kill_stale_chrome(profile_dir: Path) -> None:
    """Kill any Chrome process already holding the profile lock."""
    subprocess.run(
        ["pkill", "-f", str(profile_dir)],
        capture_output=True,
    )
    # Brief pause so the OS releases the profile lock file
    import time; time.sleep(1)


async def scrape() -> dict:
    from patchright.async_api import async_playwright
    from lib.linkedin.extractor import extract_connections

    profile_dir = Path(os.environ.get("LINKEDIN_PROFILE_DIR", str(DEFAULT_PROFILE_DIR))).expanduser()
    if not profile_dir.exists():
        return {
            "connections": [],
            "error": f"Profile dir not found: {profile_dir}. Run `linkedin-mcp-server --login` first.",
        }

    _kill_stale_chrome(profile_dir)

    async with async_playwright() as p:
        headless = os.environ.get("LINKEDIN_HEADLESS", "0") == "1"
        ctx = await p.chromium.launch_persistent_context(
            str(profile_dir),
            headless=headless,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(CONNECTIONS_URL, wait_until="domcontentloaded", timeout=30_000)
            if "/login" in page.url or "/checkpoint" in page.url:
                return {
                    "connections": [],
                    "error": "LinkedIn session expired. Re-connect via the app.",
                }

            # Wait for connection cards to appear
            try:
                await page.wait_for_selector(CARD_SELECTOR, timeout=20_000)
            except Exception:
                # Selector may have changed — try to proceed anyway
                pass
            await page.wait_for_timeout(2000)

            seen_urls: dict[str, dict] = {}
            stable_rounds = 0

            # Extract round 0 before any interaction
            html = await page.content()
            for conn in extract_connections(html):
                url = conn.get("profileUrl", "")
                if url:
                    seen_urls[url] = conn

            for step in range(MAX_SCROLLS):
                # Scroll the last visible connection card into view.
                # This triggers LinkedIn's IntersectionObserver sentinel to load
                # the next batch — more reliable than wheel/keyboard scroll.
                await page.evaluate("""() => {
                    const cards = document.querySelectorAll("a[data-view-name='connections-profile']");
                    if (!cards.length) return;
                    cards[cards.length - 1].scrollIntoView({behavior: 'instant', block: 'end'});
                }""")
                await page.wait_for_timeout(3000)

                html = await page.content()
                batch = extract_connections(html)
                new_this_round = 0
                for conn in batch:
                    url = conn.get("profileUrl", "")
                    if url and url not in seen_urls:
                        seen_urls[url] = conn
                        new_this_round += 1

                if new_this_round == 0:
                    stable_rounds += 1
                    if stable_rounds >= MAX_STABLE_ROUNDS:
                        break
                else:
                    stable_rounds = 0

            return {"connections": list(seen_urls.values()), "error": None}
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
