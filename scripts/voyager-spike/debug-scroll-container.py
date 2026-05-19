"""Find selector + scroll container on LinkedIn connections page."""
import asyncio, os
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=False, viewport={"width": 1280, "height": 900})
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto("https://www.linkedin.com/mynetwork/invite-connect/connections/", wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(4000)
        print("URL:", page.url)

        # Find all data-view-name values to discover the current selector
        view_names = await page.evaluate("""() => {
            const names = new Set([...document.querySelectorAll('[data-view-name]')].map(e => e.getAttribute('data-view-name')));
            return [...names];
        }""")
        print("data-view-name values:", view_names)

        # Find any li elements or cards that look like connection cards
        li_count = await page.evaluate("() => document.querySelectorAll('li').length")
        print("li elements:", li_count)

        # Try to find connection-like elements
        candidates = await page.evaluate("""() => {
            return [...document.querySelectorAll('li')]
                .filter(li => li.querySelector('a[href*="/in/"]'))
                .slice(0, 3)
                .map(li => ({
                    text: li.innerText.slice(0, 100),
                    href: li.querySelector('a[href*="/in/"]')?.href?.slice(0, 80),
                    dataViewName: li.getAttribute('data-view-name')
                }));
        }""")
        print("\nConnection-like li elements:")
        for c in candidates:
            print(f"  href={c['href']} text={c['text'][:60]!r}")

        # Scrollable containers
        containers = await page.evaluate("""() => {
            return [...document.querySelectorAll('*')]
                .filter(el => {
                    const s = window.getComputedStyle(el);
                    return (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                           el.scrollHeight > el.clientHeight + 200;
                })
                .map(el => ({
                    tag: el.tagName, id: el.id.slice(0,30),
                    class: el.className.toString().slice(0, 60),
                    scrollH: el.scrollHeight, clientH: el.clientHeight,
                    innerLiCount: el.querySelectorAll('li').length
                }))
                .sort((a,b) => b.innerLiCount - a.innerLiCount)
                .slice(0, 5);
        }""")
        print("\nScrollable containers:")
        for c in containers:
            print(f"  {c['tag']}#{c['id']} scrollH={c['scrollH']} clientH={c['clientH']} li={c['innerLiCount']}")
            print(f"    class={c['class'][:60]}")

        await ctx.close()

asyncio.run(main())
