"""Debug virtual scroll — find the right scroll container and confirm items change."""
import asyncio, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
CARD_SELECTOR = "a[data-view-name='connections-profile']"
CONNECTIONS_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/"

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False, viewport={"width": 1280, "height": 900})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        await page.goto(CONNECTIONS_URL, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_selector(CARD_SELECTOR, timeout=15_000)
        await page.wait_for_timeout(2000)

        # Click into the list to give it focus
        await page.click(CARD_SELECTOR)
        await page.wait_for_timeout(500)
        await page.keyboard.press("Escape")  # don't navigate
        await page.wait_for_timeout(500)

        # Try multiple scroll methods and see which one changes the cards
        def get_hrefs():
            return page.eval_on_selector_all(CARD_SELECTOR, "els => els.map(e => e.href).filter(Boolean)")

        before = await get_hrefs()
        print(f"Before scroll: {len(before)} hrefs, first: {before[0][:60] if before else 'none'}")

        # Method 1: mouse wheel on the list container
        list_el = await page.query_selector("ul.mn-connections__list, [data-view-name='connections-list'], main, .scaffold-layout__main")
        if list_el:
            await list_el.scroll_into_view_if_needed()
            await list_el.hover()
            print("Scrolling via hover on list element…")
        await page.mouse.wheel(0, 5000)
        await page.wait_for_timeout(3000)

        after_method1 = await get_hrefs()
        print(f"After mouse.wheel: {len(after_method1)} hrefs, first: {after_method1[0][:60] if after_method1 else 'none'}")
        print(f"  Items changed: {before[0][:40] != after_method1[0][:40] if before and after_method1 else 'N/A'}")

        # Method 2: keyboard Page Down
        await page.keyboard.press("Tab")
        await page.wait_for_timeout(200)
        for _ in range(5):
            await page.keyboard.press("PageDown")
            await page.wait_for_timeout(500)
        await page.wait_for_timeout(2000)

        after_method2 = await get_hrefs()
        print(f"After PageDown: {len(after_method2)} hrefs, first: {after_method2[0][:60] if after_method2 else 'none'}")
        print(f"  Items changed: {before[0][:40] != after_method2[0][:40] if before and after_method2 else 'N/A'}")

        # Method 3: scroll via JS on document
        await page.evaluate("window.scrollBy(0, 5000)")
        await page.wait_for_timeout(3000)
        after_method3 = await get_hrefs()
        print(f"After JS scrollBy: {len(after_method3)} hrefs, first: {after_method3[0][:60] if after_method3 else 'none'}")
        print(f"  Items changed: {before[0][:40] != after_method3[0][:40] if before and after_method3 else 'N/A'}")

        # Find all scrollable containers
        containers = await page.evaluate("""() => {
            const scrollable = [];
            document.querySelectorAll('*').forEach(el => {
                const s = getComputedStyle(el);
                if ((s.overflow === 'auto' || s.overflow === 'scroll' ||
                     s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                    el.scrollHeight > el.clientHeight + 50) {
                    scrollable.push({
                        tag: el.tagName,
                        class: el.className.slice(0, 60),
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight
                    });
                }
            });
            return scrollable.slice(0, 10);
        }""")
        print("\nScrollable containers found:")
        for c in containers:
            print(f"  {c['tag']} .{c['class'][:50]}  scrollH={c['scrollHeight']} clientH={c['clientHeight']}")

        await ctx.close()

asyncio.run(main())
