#!/usr/bin/env python3
"""
Bulk LinkedIn profile + company scraper.

Reads a JSON array of {id, profileUrl} from stdin.
Opens ONE Patchright session and visits each profile, then each unique company.
Outputs a JSON array of enrichment records to stdout.

Env:
  LINKEDIN_PROFILE_DIR  — path to saved browser profile (default ~/.linkedin-mcp/profile)
  LINKEDIN_HEADLESS     — set to "1" to run headless (default: 0)
"""

from __future__ import annotations
import asyncio, json, os, re, sys
from pathlib import Path

DEFAULT_PROFILE_DIR = Path.home() / ".linkedin-mcp" / "profile"


def _extract_company_slug(html: str) -> str:
    m = re.search(r'/company/([a-zA-Z0-9_-]+)/', html)
    return m.group(1) if m else ""


def _extract_employees(html: str) -> int | None:
    patterns = [
        r'"staffCount":\s*(\d+)',
        r'(\d[\d,]+)\s+employees on LinkedIn',
        r'(\d[\d,]+)\s+Employee',
        r'Company size\s*[:\-]?\s*([\d,]+(?:\s*[-–]\s*[\d,]+)?)',
    ]
    for p in patterns:
        m = re.search(p, html, re.IGNORECASE)
        if m:
            raw = m.group(1).replace(",", "").split("-")[0].split("–")[0].strip()
            try:
                return int(raw)
            except ValueError:
                continue
    return None


async def scrape(contacts: list[dict]) -> list[dict]:
    from patchright.async_api import async_playwright

    profile_dir = Path(
        os.environ.get("LINKEDIN_PROFILE_DIR", str(DEFAULT_PROFILE_DIR))
    ).expanduser()
    headless = os.environ.get("LINKEDIN_HEADLESS", "0") == "1"

    results: dict[str, dict] = {}

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(profile_dir), headless=headless,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # Pass 1: visit each profile
        company_slugs: dict[str, str] = {}  # contactId -> slug

        for contact in contacts:
            cid = contact["id"]
            url = contact["profileUrl"].rstrip("/") + "/"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                if "/login" in page.url or "/checkpoint" in page.url:
                    print(json.dumps({"error": "session_expired"}), flush=True)
                    await ctx.close()
                    return []
                await page.wait_for_timeout(1500)
                html = await page.content()

                # Extract location via JS — more reliable than regex on obfuscated classes
                location = await page.evaluate("""() => {
                    const NOISE = ['connect','follow','message','linkedin','people also','ago','degree','view','edit','add','ceo','cto','coo','cfo','founder','manager','director','partner','head of','·','@'];
                    const COUNTRIES = ['israel','usa','united states','uk','united kingdom','germany','france','india','canada','australia','singapore','netherlands','spain','sweden','denmark'];
                    const CITIES = ['tel aviv','jerusalem','haifa','new york','london','berlin','paris','san francisco','seattle','boston','austin','chicago','toronto','amsterdam','dublin'];
                    for (const el of document.querySelectorAll('span, p')) {
                        const t = (el.innerText || '').trim();
                        if (t.length < 4 || t.length > 60) continue;
                        const tl = t.toLowerCase();
                        // Skip anything that looks like a title or contains noise
                        if (NOISE.some(function(s){ return tl.indexOf(s) !== -1; })) continue;
                        // Must match a known country or city
                        if (COUNTRIES.some(function(c){ return tl.indexOf(c) !== -1; })) return t;
                        if (CITIES.some(function(c){ return tl.indexOf(c) !== -1; })) return t;
                        // "City, Country" pattern — both parts must be 2+ words max
                        const parts = t.split(',');
                        if (parts.length === 2) {
                            const a = parts[0].trim(), b = parts[1].trim();
                            if (a.split(' ').length <= 4 && b.split(' ').length <= 3 && /^[A-Za-z\\s-]+$/.test(a) && /^[A-Za-z\\s-]+$/.test(b)) return t;
                        }
                    }
                    return '';
                }""") or ""

                slug = _extract_company_slug(html)
                results[cid] = {"id": cid, "location": location, "companySlug": slug}
                if slug:
                    company_slugs[cid] = slug
                print(
                    json.dumps({"progress": cid, "location": location, "slug": slug}),
                    flush=True,
                )
            except Exception as e:
                results[cid] = {"id": cid, "error": str(e)}

        # Pass 2: visit each unique company page
        unique_slugs = list({s for s in company_slugs.values() if s})
        company_data: dict[str, dict] = {}

        for slug in unique_slugs:
            try:
                await page.goto(
                    f"https://www.linkedin.com/company/{slug}/about/",
                    wait_until="domcontentloaded",
                    timeout=20_000,
                )
                await page.wait_for_timeout(1500)
                html = await page.content()

                # Extract industry via JS
                industry = await page.evaluate("""() => {
                    for (const el of document.querySelectorAll('span, p, dd')) {
                        const t = el.innerText?.trim() || '';
                        if (t.length < 3 || t.length > 80) continue;
                        if (/^(information technology|software|internet|financial services|staffing|healthcare|real estate|education|retail|manufacturing|consulting|media|telecommunications|fintech|saas|e-commerce|cybersecurity|artificial intelligence)/i.test(t)) return t;
                    }
                    return '';
                }""") or ""

                employees = _extract_employees(html)
                company_data[slug] = {"industry": industry, "employees": employees}
                print(
                    json.dumps({"company": slug, "industry": industry, "employees": employees}),
                    flush=True,
                )
            except Exception as e:
                company_data[slug] = {"industry": "", "employees": None, "error": str(e)}

        await ctx.close()

    # Merge company data into contact results
    for cid, slug in company_slugs.items():
        cd = company_data.get(slug, {})
        if cid in results:
            results[cid]["industry"] = cd.get("industry", "")
            if cd.get("employees"):
                results[cid]["employees"] = cd["employees"]

    return list(results.values())


def main():
    raw = sys.stdin.read().strip()
    try:
        contacts = json.loads(raw)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}), flush=True)
        sys.exit(1)

    try:
        results = asyncio.run(scrape(contacts))
        print(json.dumps({"done": True, "results": results}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}), flush=True)


if __name__ == "__main__":
    main()
