"""Try End/PageDown keyboard scroll on connections page after click-focus, and check if new items load."""
import asyncio, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"

def get_profiles(page):
    return page.evaluate("""() => {
        const links = [...document.querySelectorAll('a[href*="/in/"]')];
        return [...new Set(links.map(a => a.href.split('?')[0]).filter(h => h.includes('/in/')))];
    }""")

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False, viewport={"width": 1280, "height": 900})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
        if "/login" in page.url:
            print("NOT LOGGED IN"); await ctx.close(); return

        await page.goto(CONNECTIONS_URL, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(4000)

        before = await get_profiles(page)
        print(f"Initial: {len(before)} profiles")

        # Click somewhere on the page to give it focus
        await page.mouse.click(640, 400)
        await page.wait_for_timeout(500)

        all_profiles = set(before)
        stable_rounds = 0

        for i in range(20):
            # Press End to scroll to bottom
            await page.keyboard.press("End")
            await page.wait_for_timeout(2000)
            current = await get_profiles(page)
            new_count = len(set(current) - all_profiles)
            all_profiles.update(current)
            print(f"Round {i+1}: {len(current)} visible, {new_count} new, total unique: {len(all_profiles)}")
            if new_count == 0:
                stable_rounds += 1
                if stable_rounds >= 3:
                    print("Stable — no more new profiles loading")
                    break
            else:
                stable_rounds = 0

        print(f"\nFinal unique profiles: {len(all_profiles)}")
        print("Sample:", list(all_profiles)[:5])
        await ctx.close()

asyncio.run(main())
