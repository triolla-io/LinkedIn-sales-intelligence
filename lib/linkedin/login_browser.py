"""Open a browser for the user to log in to LinkedIn, then extract cookies automatically.

Prints a single JSON line to stdout:
  {"li_at": "...", "JSESSIONID": "...", "error": null}   on success
  {"li_at": null, "JSESSIONID": null, "error": "..."}    on failure/timeout

Profile dir: $LINKEDIN_PROFILE_DIR (default ~/.linkedin-mcp/profile).
Timeout: $LOGIN_TIMEOUT_SECONDS (default 300 = 5 minutes).
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
from pathlib import Path

PROFILE_DIR = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
TIMEOUT = int(os.environ.get("LOGIN_TIMEOUT_SECONDS", "300"))
POLL_INTERVAL = 2  # seconds between cookie checks


async def run() -> dict:
    from patchright.async_api import async_playwright

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = await ctx.new_page()

        # Go straight to LinkedIn login page
        await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded", timeout=30_000)

        # Poll until li_at cookie appears (user completed login) or timeout
        elapsed = 0
        li_at = None
        jsessionid = None

        while elapsed < TIMEOUT:
            cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
            li_at = cookies.get("li_at")
            jsessionid = cookies.get("JSESSIONID")

            if li_at and li_at.startswith("AQE"):
                # Confirmed logged-in session cookie
                break

            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

            # If user navigated away from login (e.g. to feed), check immediately
            if "/login" not in page.url and "/checkpoint" not in page.url:
                await asyncio.sleep(1)  # brief wait for cookies to settle
                cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
                li_at = cookies.get("li_at")
                jsessionid = cookies.get("JSESSIONID")
                if li_at and li_at.startswith("AQE"):
                    break

        await ctx.close()

    if not li_at:
        return {"li_at": None, "JSESSIONID": None, "error": "Timed out waiting for login. Please try again."}

    # Persist ALL linkedin.com cookies so voyager_client.py can inject them
    # into a fresh browser context without holding the profile lock.
    import time as _time
    cookie_cache = PROFILE_DIR / "voyager_cookies.json"
    # Re-read the full cookie set (not just li_at + JSESSIONID) right before closing
    all_cookies_full = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
    cookie_cache.write_text(json.dumps({
        "cookies": all_cookies_full,
        "saved_at": _time.time(),
    }))

    return {"li_at": li_at, "JSESSIONID": jsessionid or "", "error": None}


def main() -> int:
    try:
        result = asyncio.run(run())
    except Exception as e:  # noqa: BLE001
        result = {"li_at": None, "JSESSIONID": None, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0 if result["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
