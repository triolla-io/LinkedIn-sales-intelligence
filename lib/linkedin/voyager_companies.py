"""One-shot subprocess: read JSON slug array from stdin, enrich via Voyager, print results.

Usage:
  echo '["microsoft","google"]' | PYTHONPATH=. uv run --with "aiohttp patchright" python lib/linkedin/voyager_companies.py

Output (single JSON line):
  {"companies": [...], "error": null}
  {"companies": [], "error": "SESSION_EXPIRED: ..."}
"""
from __future__ import annotations
import asyncio
import json
import sys
from typing import Any

import aiohttp

from lib.linkedin.voyager_client import (
    RateLimitError,
    SessionExpiredError,
    voyager_get,
)

CONCURRENCY = 3
PATH = "/organization/companies"


def _parse_company(slug: str, raw: dict[str, Any]) -> dict[str, Any] | None:
    incl = raw.get("included", [])
    company = next(
        (x for x in incl if "Company" in x.get("$type", "") or "Organization" in x.get("$type", "")),
        None,
    )
    if not company:
        return None
    industries: list[str] = company.get("industries") or []
    # Also resolve from included Industry objects if the array is URN refs
    if industries and industries[0].startswith("urn:"):
        resolved = [x.get("localizedName") for x in incl if "Industry" in x.get("$type", "")]
        industries = [r for r in resolved if r]
    return {
        "universalName": slug,
        "name": company.get("name") or "",
        "industry": industries[0] if industries else None,
        "industries": industries,
        "staffCount": company.get("staffCount"),
        "website": company.get("companyPageUrl"),
        "description": company.get("description"),
    }


async def _fetch_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    slug: str,
) -> dict[str, Any] | None:
    async with sem:
        raw = await voyager_get(session, PATH, {"q": "universalName", "universalName": slug})
    return _parse_company(slug, raw)


async def run(slugs: list[str]) -> dict[str, Any]:
    sem = asyncio.Semaphore(CONCURRENCY)
    timeout = aiohttp.ClientTimeout(total=900)
    companies: list[dict] = []
    async with aiohttp.ClientSession(timeout=timeout) as session:
        tasks = [_fetch_one(session, sem, slug) for slug in slugs]
        for result in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(result, Exception):
                sys.stderr.write(f"fetch failed: {result}\n")
            elif result:
                companies.append(result)
    return {"companies": companies, "error": None}


def main() -> int:
    raw_in = sys.stdin.read().strip()
    try:
        slugs = json.loads(raw_in)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"companies": [], "error": f"Invalid JSON input: {e}"}))
        return 1
    if not isinstance(slugs, list):
        sys.stdout.write(json.dumps({"companies": [], "error": "stdin must be JSON array of strings"}))
        return 1
    try:
        result = asyncio.run(run(slugs))
    except SessionExpiredError as e:
        result = {"companies": [], "error": f"SESSION_EXPIRED: {e}"}
    except RateLimitError as e:
        result = {"companies": [], "error": f"RATE_LIMITED: {e}"}
    except Exception as e:  # noqa: BLE001
        result = {"companies": [], "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")
    return 0 if result["error"] is None else 1


if __name__ == "__main__":
    sys.exit(main())
