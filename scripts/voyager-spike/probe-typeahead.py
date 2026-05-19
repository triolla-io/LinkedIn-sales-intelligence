"""Probe LinkedIn's typeahead/hitsV2 endpoint via voyager_client (aiohttp + Patchright cookies)."""
import asyncio, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import aiohttp

BASE = "https://www.linkedin.com/voyager/api"
SAMPLES = ["Mobileye", "Microsoft", "Bet Shemesh Engines Ltd.", "Evinced", "Tomorrow.io"]


async def main():
    from lib.linkedin.voyager_client import voyager_get

    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for name in SAMPLES:
            try:
                data = await voyager_get(
                    session,
                    "/typeahead/hitsV2",
                    {
                        "keywords": name,
                        "origin": "OTHER",
                        "q": "type",
                        "queryContext": "List(typeaheadFilterValues:List(resultType->COMPANY))",
                        "count": "3",
                    },
                )
            except Exception as e:
                print(f"\n=== {name!r} → ERROR: {e} ===")
                continue

            included = data.get("included", [])
            print(f"\n=== {name!r} ===")
            print(f"  included count: {len(included)}")
            for inc in included[:5]:
                t = inc.get("$type", "")
                if "Company" in t or "Organization" in t or inc.get("universalName"):
                    print(f"  → $type={t.split('.')[-1]!r} name={inc.get('name')!r} universalName={inc.get('universalName')!r}")

            if name == "Mobileye":
                Path("tests/fixtures/voyager-typeahead-sample.json").write_text(
                    json.dumps(data, indent=2)
                )
                print("  saved fixture")


asyncio.run(main())
