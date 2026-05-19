"""Smoke test: call /voyager/api/organization/companies?q=universalName&universalName=microsoft
and confirm employeeCountRange + industries are present.
"""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE = Path("tests/fixtures/voyager-companies-sample.json")
BASE = "https://www.linkedin.com/voyager/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

SLUGS = ["microsoft", "apple", "google"]


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()

        print("Warming up session...")
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        if "/login" in page.url:
            print("NOT LOGGED IN — re-run linkedin-mcp-server --login")
            await ctx.close()
            return

        cookies = {c["name"]: c["value"] for c in await ctx.cookies("https://www.linkedin.com")}
        jsess = cookies.get("JSESSIONID", "").strip('"')
        print(f"li_at: {bool(cookies.get('li_at'))}  JSESSIONID: {jsess[:30]}")

        headers = {
            "csrf-token": jsess,
            "x-restli-protocol-version": "2.0.0",
            "user-agent": UA,
            "accept": "application/vnd.linkedin.normalized+json+2.1",
            "x-li-lang": "en_US",
        }
        request = ctx.request

        for slug in SLUGS:
            print(f"\n=== universalName={slug} ===")
            r = await request.get(
                f"{BASE}/organization/companies",
                params={"q": "universalName", "universalName": slug},
                headers=headers,
            )
            body = await r.text()
            print(f"Status: {r.status}")
            if r.status != 200:
                print("Body:", body[:300])
                continue

            data = json.loads(body)
            incl = data.get("included", [])
            company = next(
                (x for x in incl if "Company" in x.get("$type", "") or "Organization" in x.get("$type", "")),
                data.get("data", {})
            )
            print(f"$type: {company.get('$type')}")
            print(f"name: {company.get('name')}")
            print(f"universalName: {company.get('universalName')}")
            print(f"employeeCountRange: {company.get('employeeCountRange')}")
            print(f"industries: {company.get('industries')}")
            print(f"staffCount: {company.get('staffCount')}")
            print(f"Top-level data keys: {list(data.get('data', {}).keys())[:15]}")
            print(f"included types: { {x.get('$type','?') for x in incl} }")

            if slug == "microsoft":
                FIXTURE.parent.mkdir(parents=True, exist_ok=True)
                FIXTURE.write_text(body)
                print(f"Saved fixture to {FIXTURE}")

        await ctx.close()


asyncio.run(main())
