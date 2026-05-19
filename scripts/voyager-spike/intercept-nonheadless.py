"""Intercept Voyager XHRs from the connections page in non-headless mode (so cards actually render).

Also probes the mini-profile batch API and GraphQL connections queryIds.
"""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE_DIR = Path("tests/fixtures")
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

CARD_SELECTOR = "a[data-view-name='connections-profile']"
BASE = "https://www.linkedin.com/voyager/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# GraphQL queryId candidates seen in community projects / JS bundles
GQL_QUERY_IDS = [
    "voyagerRelationshipsDashConnectionsSearch",
    "voyagerNetworkDashNormalizedConnections",
    "voyagerMyNetworkDashNormalizedConnectionsSearch",
    "voyagerMyNetworkDashConnections",
]

async def main():
    captured = []

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = await ctx.new_page()

        async def on_response(resp):
            if "voyager/api" in resp.url and resp.status == 200:
                try:
                    body = await resp.text()
                    if len(body) > 500:
                        captured.append((resp.url, body))
                except Exception:
                    pass

        page.on("response", on_response)

        print("Warming up session via feed...")
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        if "/login" in page.url:
            print("NOT LOGGED IN"); await ctx.close(); return
        print("Loading connections page (non-headless)...")
        await page.goto(
            "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            wait_until="domcontentloaded",
            timeout=30000,
        )
        await page.wait_for_timeout(5000)

        # Wait for cards
        try:
            await page.wait_for_selector(CARD_SELECTOR, timeout=20000)
            count = await page.eval_on_selector_all(CARD_SELECTOR, "els => els.length")
            print(f"Cards visible: {count}")
        except Exception as e:
            print(f"No cards: {e}")

        # Scroll a few times
        for _ in range(3):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

        # Get cookies for direct API calls below
        cookies_list = await ctx.cookies("https://www.linkedin.com")
        cookies = {c["name"]: c["value"] for c in cookies_list}
        jsess = cookies.get("JSESSIONID", "").strip('"')
        print(f"li_at present: {bool(cookies.get('li_at'))}")

        request = ctx.request
        headers = {
            "csrf-token": jsess,
            "x-restli-protocol-version": "2.0.0",
            "user-agent": UA,
            "accept": "application/vnd.linkedin.normalized+json+2.1",
            "x-li-lang": "en_US",
        }

        # Try mini-profile batch API
        # Get a connection URN from the DOM
        card_hrefs = await page.eval_on_selector_all(CARD_SELECTOR, "els => els.slice(0,3).map(e => e.href)")
        public_ids = [h.split("/in/")[-1].strip("/").split("?")[0] for h in card_hrefs if "/in/" in h]
        print("\nPublic IDs from cards:", public_ids[:3])

        if public_ids:
            print("\n=== Testing mini-profile batch API ===")
            # /identity/profiles?q=memberIdentitiesByPublicIdentifiers&memberIdentities=List(id1,id2)
            pid_list = ",".join(public_ids[:3])
            r = await request.get(
                f"{BASE}/identity/profiles",
                params={"q": "memberIdentitiesByPublicIdentifiers", "memberIdentities": f"List({pid_list})", "decorationId": "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93"},
                headers=headers,
            )
            body = await r.text()
            print(f"Status: {r.status}")
            if r.status == 200:
                d = json.loads(body)
                incl = d.get("included", [])
                types = {}
                for inc in incl:
                    t = inc.get("$type", "?")
                    types[t] = types.get(t, 0) + 1
                print(f"types: {types}")
                for inc in incl:
                    if inc.get("firstName") and inc.get("headline"):
                        print(f"  ✅ {inc.get('firstName')} {inc.get('lastName')} | {inc.get('headline','')[:60]}")
            else:
                print("Body:", body[:300])

        # Summarize captured XHRs
        print(f"\n=== Captured {len(captured)} XHRs from page ===")
        for url, body in captured:
            kw = "⭐" if any(k in body for k in ("firstName","connectedMember","fsd_connection")) else "  "
            print(f"{kw} {len(body):7d}b  {url[:120]}")

        await ctx.close()

asyncio.run(main())
