"""Inspect the full DOM structure of a few connection cards to find company field."""
import asyncio, os
from pathlib import Path
from patchright.async_api import async_playwright
from bs4 import BeautifulSoup

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"
CARD_SELECTOR = "a[data-view-name='connections-profile']"

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False, viewport={"width": 1280, "height": 900})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(CONNECTIONS_URL, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_selector(CARD_SELECTOR, timeout=15_000)
        await page.wait_for_timeout(2000)

        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.find_all("a", attrs={"data-view-name": "connections-profile"})

        print(f"Cards found: {len(cards)}")
        for card in cards[:5]:
            paras = card.find_all("p")
            spans = card.find_all("span")
            print(f"\n--- Card ---")
            print(f"  paragraphs ({len(paras)}):")
            for i, p_tag in enumerate(paras):
                print(f"    p[{i}]: {p_tag.get_text(strip=True)[:80]!r}")
            print(f"  spans with text ({len(spans)}):")
            for s in spans:
                t = s.get_text(strip=True)
                if t and len(t) > 2:
                    print(f"    {t[:80]!r}")

        await ctx.close()

asyncio.run(main())
