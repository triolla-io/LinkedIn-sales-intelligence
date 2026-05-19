"""Launch Patchright with the linkedin-mcp persistent profile, navigate to linkedin.com, dump ALL cookies as JSON to stdout."""
import asyncio, json, os, sys
from pathlib import Path
from patchright.async_api import async_playwright

PROFILE = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(PROFILE), headless=True)
        try:
            page = await ctx.new_page()
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
            all_cookies = await ctx.cookies("https://www.linkedin.com")
        finally:
            await ctx.close()
    out = {c["name"]: c["value"] for c in all_cookies}
    print(json.dumps(out))

asyncio.run(main())
