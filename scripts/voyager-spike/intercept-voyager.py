"""Open the LinkedIn connections page, wait for cards to render, capture all Voyager XHRs.

Saves all captured responses that mention profiles or connections to fixtures/.
"""
import asyncio, json, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE_DIR = Path("tests/fixtures")
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

CARD_SELECTOR = "a[data-view-name='connections-profile']"
KEYWORDS = ("fsd_profile", "fsd_connection", "miniProfile", "firstName", "lastName")


async def main():
    captured = []

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=True)
        page = await ctx.new_page()

        async def on_response(resp):
            if "voyager/api" in resp.url and resp.status == 200:
                try:
                    body = await resp.text()
                    captured.append((resp.url, body))
                except Exception:
                    pass

        page.on("response", on_response)

        print("Navigating...")
        await page.goto(
            "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        print("Landed:", page.url)

        if "/login" in page.url:
            print("NOT LOGGED IN — re-run linkedin-mcp-server --login")
            await ctx.close()
            return

        # Wait for connection cards to appear
        try:
            await page.wait_for_selector(CARD_SELECTOR, timeout=20000)
            count = await page.eval_on_selector_all(CARD_SELECTOR, "els => els.length")
            print(f"Cards found: {count}")
        except Exception as e:
            print(f"Cards never appeared: {e}")

        # Scroll a few times to trigger lazy-load XHRs
        for i in range(5):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

        await ctx.close()

    print(f"\nTotal captured: {len(captured)} requests")
    for url, body in captured:
        has_kw = any(kw in body for kw in KEYWORDS)
        tag = "⭐" if has_kw else "  "
        print(f"{tag} {len(body):8d}b  {url[:120]}")

    # Save all starred responses
    for i, (url, body) in enumerate(captured):
        if any(kw in body for kw in KEYWORDS):
            slug = url.split("voyager/api")[-1].split("?")[0].replace("/", "_").strip("_")[:60]
            p = FIXTURE_DIR / f"capture_{i:02d}_{slug}.json"
            p.write_text(body)
            print(f"\nSaved: {p}")
            try:
                data = json.loads(body)
                incl = data.get("included", [])
                types = {}
                for inc in incl:
                    t = inc.get("$type", "NONE")
                    types[t] = types.get(t, 0) + 1
                print(f"  included types: {types}")
                # Print first object that looks like a profile
                for inc in incl:
                    t = inc.get("$type", "")
                    if "Profile" in t or "Member" in t or "miniProfile" in t.lower():
                        print("  First profile-type keys:", list(inc.keys()))
                        print("  firstName:", inc.get("firstName"))
                        print("  lastName:", inc.get("lastName"))
                        print("  headline:", inc.get("headline"))
                        print("  Sample (500B):", json.dumps(inc, indent=2)[:500])
                        break
            except Exception:
                pass

asyncio.run(main())
