"""Navigate to the LinkedIn connections page and extract any JSON embedded in the HTML.

Looks for __NEXT_DATA__, JSTOR_STATE, or voyager prefetch data.
"""
import asyncio, json, os, re
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
FIXTURE_DIR = Path("tests/fixtures")
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

CARD_SELECTOR = "a[data-view-name='connections-profile']"


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=True)
        page = await ctx.new_page()
        await page.goto(
            "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            wait_until="domcontentloaded",
            timeout=60000,
        )
        if "/login" in page.url:
            print("Not logged in!")
            await ctx.close()
            return

        try:
            await page.wait_for_selector(CARD_SELECTOR, timeout=20000)
            count = await page.eval_on_selector_all(CARD_SELECTOR, "els => els.length")
            print(f"Connection cards visible: {count}")
        except Exception as e:
            print(f"Cards: {e}")

        # Extract embedded JSON blobs
        scripts = await page.eval_on_selector_all("script", "els => els.map(e => [e.type, e.id, e.textContent.length, e.textContent.slice(0, 200)])")
        print(f"\n{len(scripts)} script tags:")
        for t, sid, length, preview in scripts:
            if length > 100:
                print(f"  type={t!r} id={sid!r} len={length} preview={preview[:120]!r}")

        # Try to pull linkedin's embedded state from a code-split chunk
        # LinkedIn uses window.__reactFiber or window.voyagerCache
        keys = await page.evaluate("() => Object.keys(window).filter(k => k.includes('store') || k.includes('State') || k.includes('linkedin') || k.includes('voyager') || k.includes('cache'))")
        print("\nLinkedIn window vars:", keys[:20])

        # Get the first card's aria-label or inner text to confirm what data is visible
        cards_text = await page.eval_on_selector_all(CARD_SELECTOR, "els => els.slice(0,3).map(e => e.innerText.slice(0, 200))")
        print("\nFirst 3 cards text:")
        for t in cards_text:
            print(" ", repr(t[:200]))

        await ctx.close()

asyncio.run(main())
