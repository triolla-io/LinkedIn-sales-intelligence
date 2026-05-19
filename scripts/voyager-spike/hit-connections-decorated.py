"""Try the Voyager connections endpoint with a decorationId to get richer inline profile data.

The shallow /relationships/dash/connections endpoint returns normalized URN refs.
decorationId asks the server to resolve those refs inline in the response.

Also tries the profile endpoint for one connection URN to see the available fields.
"""
import asyncio, json, os, sys
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE_DIR = Path("tests/fixtures")
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

BASE = "https://www.linkedin.com/voyager/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

DECORATION_IDS = [
    "com.linkedin.voyager.dash.deco.relationships.FullConnectionResolution-5",
    "com.linkedin.voyager.dash.deco.relationships.FullConnectionResolution-4",
    "com.linkedin.voyager.dash.deco.relationships.FullConnectionResolution-3",
    "com.linkedin.voyager.dash.deco.relationships.FullConnectionResolution-2",
    "com.linkedin.voyager.dash.deco.relationships.FullConnectionResolution",
    "com.linkedin.voyager.dash.deco.relationships.FullConnection",
]

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()
        print("Navigating to feed to warm up session...")
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        if "/login" in page.url:
            print("NOT LOGGED IN")
            await ctx.close()
            return

        cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
        jsess = cookies.get("JSESSIONID", "").strip('"')
        li_at = cookies.get("li_at", "")
        print("li_at present:", bool(li_at))
        print("JSESSIONID:", jsess[:30])

        headers = {
            "csrf-token": jsess,
            "x-restli-protocol-version": "2.0.0",
            "user-agent": UA,
            "accept": "application/vnd.linkedin.normalized+json+2.1",
            "x-li-lang": "en_US",
        }
        request = ctx.request

        # First: baseline call (no decoration)
        print("\n=== Baseline (no decorationId) ===")
        r = await request.get(
            f"{BASE}/relationships/dash/connections",
            params={"q": "search", "start": 0, "count": 5, "sortType": "RECENTLY_ADDED"},
            headers=headers,
        )
        body = await r.text()
        print("Status:", r.status)
        data = json.loads(body) if r.status == 200 else {}
        print("included[0] keys:", list(data.get("included", [{}])[0].keys()) if data.get("included") else "empty")
        print("connectedMember type:", type(data.get("included", [{}])[0].get("connectedMember")).__name__ if data.get("included") else "n/a")

        # Try each decorationId
        for dec in DECORATION_IDS:
            print(f"\n=== decorationId: {dec.split('.')[-1]} ===")
            r = await request.get(
                f"{BASE}/relationships/dash/connections",
                params={"q": "search", "start": 0, "count": 3, "sortType": "RECENTLY_ADDED", "decorationId": dec},
                headers=headers,
            )
            body = await r.text()
            print("Status:", r.status)
            if r.status == 200:
                d = json.loads(body)
                incl = d.get("included", [])
                print(f"included count: {len(incl)}")
                types = {}
                for inc in incl:
                    t = inc.get("$type", "?")
                    types[t] = types.get(t, 0) + 1
                print("types:", types)
                # Check if any included has firstName
                for inc in incl:
                    if inc.get("firstName"):
                        print("  ✅ firstName found:", inc.get("firstName"), inc.get("lastName"))
                        print("  keys:", list(inc.keys()))
                        out = FIXTURE_DIR / f"voyager-connections-{dec.split('.')[-1]}.json"
                        out.write_text(body)
                        print("  Saved:", out)
                        break
                else:
                    # Check connectedMember type
                    sample = incl[0] if incl else {}
                    cm = sample.get("connectedMember")
                    print("  connectedMember type:", type(cm).__name__, "val:", str(cm)[:60] if cm else "None")
            else:
                print("Body:", body[:200])

        await ctx.close()

asyncio.run(main())
