"""Call Voyager from inside a Patchright browser context so cookies + browser-set headers come along automatically.

Tries several endpoint variants and saves the first 200 response with a non-empty body to the fixture.
"""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE = Path("tests/fixtures/voyager-connections-sample.json")

ATTEMPTS = [
    ("GET", "/relationships/dash/connections", {"q": "search", "start": 0, "count": 10, "sortType": "RECENTLY_ADDED"}),
    ("GET", "/relationships/dash/connections", {"count": 10, "start": 0}),
    ("GET", "/relationships/connections", {"q": "viewer", "start": 0, "count": 10}),
    ("GET", "/relationships/connections", {"count": 10, "start": 0}),
    ("GET", "/me", {}),
]

BASE = "https://www.linkedin.com/voyager/api"


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=True)
        try:
            page = await ctx.new_page()
            await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", wait_until="domcontentloaded")
            await page.wait_for_timeout(3000)
            print("Landed URL:", page.url)
            print("Title:", await page.title())
            # Grab JSESSIONID for csrf-token
            cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
            jsess = cookies.get("JSESSIONID", "").strip('"')
            print("Cookie names available:", list(cookies.keys()))
            print("JSESSIONID:", jsess[:40] if jsess else "(missing)")

            request = ctx.request
            for method, path, params in ATTEMPTS:
                url = BASE + path
                resp = await request.get(
                    url,
                    params=params,
                    headers={
                        "csrf-token": jsess,
                        "x-restli-protocol-version": "2.0.0",
                        "accept": "application/vnd.linkedin.normalized+json+2.1",
                        "x-li-lang": "en_US",
                    },
                    max_redirects=0,
                )
                body = await resp.text()
                print(f"--- {path} {params}")
                print(f"Status: {resp.status}")
                print(f"First 600B: {body[:600]}")
                print()
                if resp.status == 200 and body.strip() and ("connections" in path or path == "/me"):
                    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
                    FIXTURE.write_text(body)
                    print(f"Saved fixture to {FIXTURE}")
                    return
        finally:
            await ctx.close()


asyncio.run(main())
