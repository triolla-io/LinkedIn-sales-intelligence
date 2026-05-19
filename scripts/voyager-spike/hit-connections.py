"""Smoke test against /voyager/api/relationships/dash/connections and known variants.

Reads LI_AT and JSESSIONID from env. Tries multiple endpoints + param combos to find one
that returns connection data, then saves the raw response to tests/fixtures/voyager-connections-sample.json.
"""
import asyncio, json, os, sys
import aiohttp

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
FIXTURE = "tests/fixtures/voyager-connections-sample.json"

ATTEMPTS = [
    # Modern dash endpoint, may need q=search
    ("/relationships/dash/connections", {"q": "search", "start": 0, "count": 10, "sortType": "RECENTLY_ADDED"}),
    ("/relationships/dash/connections", {"count": 10, "start": 0}),
    # Legacy endpoint
    ("/relationships/connections", {"q": "viewer", "start": 0, "count": 10}),
    ("/relationships/connections", {"count": 10, "start": 0}),
    # Profile API alternative — known to return connection counts
    ("/me", {}),
]

async def try_one(s, path, params):
    url = f"https://www.linkedin.com/voyager/api{path}"
    async with s.get(url, params=params, allow_redirects=False) as r:
        body = await r.text()
        loc = r.headers.get("location", "")
        return r.status, body, loc

async def main():
    li_at = os.environ.get("LI_AT")
    jsess = os.environ.get("JSESSIONID")
    if not li_at or not jsess:
        sys.exit("Set LI_AT and JSESSIONID env vars first.")
    cookies = {"li_at": li_at, "JSESSIONID": jsess}
    headers = {
        "csrf-token": jsess.strip('"'),
        "x-restli-protocol-version": "2.0.0",
        "user-agent": UA,
        "accept": "application/vnd.linkedin.normalized+json+2.1",
        "x-li-lang": "en_US",
        "x-li-track": '{"clientVersion":"1.13.0","mpVersion":"1.13.0","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
    }
    async with aiohttp.ClientSession(cookies=cookies, headers=headers) as s:
        for path, params in ATTEMPTS:
            status, body, loc = await try_one(s, path, params)
            print(f"--- {path} {params}")
            print(f"Status: {status}  Location: {loc}")
            print(f"First 800B: {body[:800]}")
            print()
            if status == 200 and "connections" in path:
                with open(FIXTURE, "w") as f:
                    f.write(body)
                print(f"Saved fixture to {FIXTURE}")
                return

asyncio.run(main())
