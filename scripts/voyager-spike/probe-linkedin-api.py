"""Test: initialize linkedin-api with Patchright cookies (no username/password)
and call get_profile_connections to confirm it returns name + headline for all connections."""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()


async def get_cookies() -> dict:
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(1500)
        all_cookies = await ctx.cookies("https://www.linkedin.com")
        await ctx.close()
    return {c["name"]: c["value"] for c in all_cookies}


def test_linkedin_api(cookies: dict):
    from linkedin_api import Linkedin

    li_at = cookies.get("li_at")
    jsess = cookies.get("JSESSIONID")
    if not li_at:
        print("ERROR: no li_at")
        return

    print(f"li_at: {li_at[:20]}...")
    print(f"JSESSIONID: {jsess[:30] if jsess else 'missing'}")

    # Initialize with authenticate=False and inject cookies into the session
    api = Linkedin("", "", authenticate=False)
    api.client.session.cookies.set("li_at", li_at, domain=".linkedin.com")
    if jsess:
        api.client.session.cookies.set("JSESSIONID", jsess, domain=".linkedin.com")
    api.client.session.headers.update({
        "csrf-token": (jsess or "").strip('"'),
        "x-restli-protocol-version": "2.0.0",
    })

    # Get own profile ID first
    me = api.get_user_profile()
    me_id = str(me.get("plainId", "") or me.get("profile_id", ""))
    print(f"My ID: {me_id}")
    print(f"My name: {me.get('firstName')} {me.get('lastName')}")

    # Get connections (paginated internally)
    print("\nFetching connections (first 10)...")
    conns = api.get_profile_connections(me_id, limit=10)
    print(f"Returned: {len(conns)} connections")
    for c in (conns or [])[:3]:
        mp = c.get("miniProfile", {})
        print(f"  {mp.get('firstName')} {mp.get('lastName')} | {mp.get('occupation','')[:50]} | {mp.get('publicIdentifier')}")


async def main():
    cookies = await get_cookies()
    test_linkedin_api(cookies)


asyncio.run(main())
