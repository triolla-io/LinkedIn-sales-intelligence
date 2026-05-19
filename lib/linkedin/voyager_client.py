"""Voyager API client — Path B cookie extraction (Patchright).

Launches a browser with the linkedin-mcp persistent profile to extract li_at + JSESSIONID,
caches them in-process, then makes authenticated aiohttp requests to linkedin.com/voyager/api/*.

Profile dir: $LINKEDIN_PROFILE_DIR (default ~/.linkedin-mcp/profile).
"""
from __future__ import annotations
import asyncio
import os
import random
import sys
from pathlib import Path
from typing import Any

import aiohttp

VOYAGER_BASE = "https://www.linkedin.com/voyager/api"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_cookie_cache: dict[str, str] | None = None
_cookie_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    global _cookie_lock
    if _cookie_lock is None:
        _cookie_lock = asyncio.Lock()
    return _cookie_lock


class SessionExpiredError(RuntimeError):
    pass


class RateLimitError(RuntimeError):
    pass


def _profile_dir() -> Path:
    return Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()


async def _extract_cookies() -> dict[str, str]:
    global _cookie_cache
    if _cookie_cache:
        return _cookie_cache
    async with _get_lock():
        # Re-check after acquiring lock — another coroutine may have populated it.
        if _cookie_cache:
            return _cookie_cache
        return await _do_extract_cookies()


async def _do_extract_cookies() -> dict[str, str]:
    global _cookie_cache
    from patchright.async_api import async_playwright

    profile = _profile_dir()
    if not profile.exists():
        raise SessionExpiredError(
            f"Profile not found: {profile}. Run linkedin-mcp-server --login."
        )

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(profile), headless=False)
        try:
            page = await ctx.new_page()
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(1500)
            if "/login" in page.url or "/checkpoint" in page.url:
                raise SessionExpiredError("LinkedIn session expired. Re-run linkedin-mcp-server --login.")
            all_cookies = await ctx.cookies("https://www.linkedin.com")
        finally:
            await ctx.close()

    cookies = {c["name"]: c["value"] for c in all_cookies if c["name"] in ("li_at", "JSESSIONID")}
    if "li_at" not in cookies or "JSESSIONID" not in cookies:
        raise SessionExpiredError(
            f"li_at/JSESSIONID missing after login page. Got: {list(cookies)}. "
            "Re-run linkedin-mcp-server --login."
        )
    _cookie_cache = cookies
    return cookies


def _headers(cookies: dict[str, str]) -> dict[str, str]:
    csrf = cookies["JSESSIONID"].strip('"')
    return {
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
        "user-agent": UA,
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "x-li-lang": "en_US",
    }


async def voyager_get(
    session: aiohttp.ClientSession,
    path: str,
    params: dict[str, Any] | None = None,
    *,
    max_retries: int = 3,
) -> dict[str, Any]:
    cookies = await _extract_cookies()
    url = f"{VOYAGER_BASE}{path}"
    headers = _headers(cookies)
    backoff = 1.0
    for attempt in range(max_retries + 1):
        await asyncio.sleep(random.uniform(0.1, 0.3))
        async with session.get(url, params=params, headers=headers, cookies=cookies) as resp:
            if resp.status == 401:
                raise SessionExpiredError(f"401 from Voyager {path}")
            if resp.status == 429:
                if attempt == max_retries:
                    raise RateLimitError(f"429 from Voyager {path} after {max_retries} retries")
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            if resp.status == 404:
                return {}  # caller handles missing company
            resp.raise_for_status()
            return await resp.json()
    raise RuntimeError("unreachable")
