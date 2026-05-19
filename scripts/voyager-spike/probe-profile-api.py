"""Probe: get connection URNs from the connections endpoint, then call profile API for one.
Tests that both work via ctx.request (browser context — avoids aiohttp redirect issue)."""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
BASE = "https://www.linkedin.com/voyager/api"
HEADERS = {
    "x-restli-protocol-version": "2.0.0",
    "accept": "application/vnd.linkedin.normalized+json+2.1",
    "x-li-lang": "en_US",
}

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(1500)

        cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
        jsess = cookies.get("JSESSIONID", "").strip('"')
        headers = {**HEADERS, "csrf-token": jsess}

        # Step 1: get first page of connections — check paging.total
        r = await ctx.request.get(f"{BASE}/relationships/dash/connections",
            params={"q": "search", "count": "10", "start": "0", "sortType": "RECENTLY_ADDED"},
            headers=headers)
        body = await r.json()
        print("Connections status:", r.status)
        paging = body.get("data", {}).get("paging", {})
        print("paging.total:", paging.get("total"))
        print("paging.count:", paging.get("count"))
        included = body.get("included", [])
        print("included count:", len(included))

        # Extract a profile ID from the first connection
        profile_id = None
        for inc in included:
            cm = inc.get("connectedMember", "")
            if "fsd_profile:" in cm:
                profile_id = cm.split("fsd_profile:")[-1]
                print("Sample profileId:", profile_id)
                break

        if not profile_id:
            print("No profile ID found")
            await ctx.close()
            return

        # Step 2: call the profile API
        r2 = await ctx.request.get(f"{BASE}/identity/profiles/{profile_id}",
            headers=headers)
        body2 = await r2.json()
        print("\nProfile API status:", r2.status)
        included2 = body2.get("included", [])
        print("Profile included types:", list({x.get("$type","?") for x in included2}))

        # Find the profile object
        profile = body2.get("data", {})
        print("Profile data keys:", list(profile.keys())[:15])
        print("firstName:", profile.get("firstName"))
        print("lastName:", profile.get("lastName"))
        print("headline:", profile.get("headline"))

        # Look for position/title/company in included
        for inc in included2:
            t = inc.get("$type", "")
            if "Position" in t or "Experience" in t:
                print("Position object:", json.dumps(inc, indent=2)[:400])
                break

        await ctx.close()

asyncio.run(main())
