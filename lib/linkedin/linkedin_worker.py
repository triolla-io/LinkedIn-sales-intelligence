#!/usr/bin/env python3
"""
Thin LinkedIn API wrapper. Reads commands from stdin (one JSON per line),
writes results to stdout (one JSON per line). Called by mcp-client.ts.

Authentication (pick one):
  LINKEDIN_USERNAME + LINKEDIN_PASSWORD  — credential auth (cookies cached after first run)
  LINKEDIN_COOKIES_DIR                   — directory containing cached .jr cookie files

Commands:
  {"cmd":"get_connections"}
  {"cmd":"get_profile","urn":"urn:li:member:123"}
  {"cmd":"send_message","urn":"urn:li:member:123","body":"hello"}
  {"cmd":"validate"}
"""

import json
import os
import sys
import traceback

from linkedin_api import Linkedin


def build_client() -> Linkedin:
    username = os.environ.get("LINKEDIN_USERNAME", "")
    password = os.environ.get("LINKEDIN_PASSWORD", "")
    cookies_dir = os.environ.get("LINKEDIN_COOKIES_DIR", "/tmp/linkedin_cookies/")

    if not username or not password:
        raise ValueError("LINKEDIN_USERNAME and LINKEDIN_PASSWORD env vars are required")

    os.makedirs(cookies_dir, exist_ok=True)
    return Linkedin(username, password, cookies_dir=cookies_dir)


def extract_urn_id(urn: str) -> str:
    return urn.split(":")[-1]


def handle_get_connections(client: Linkedin) -> dict:
    me = client.get_user_profile() or {}
    me_id = str(me.get("plainId", "") or "")

    raw = client.get_profile_connections(me_id) if me_id else []
    items = []
    for conn in (raw or []):
        profile = conn.get("miniProfile", {})
        conn_urn = profile.get("entityUrn", "")
        if not conn_urn:
            conn_urn = f"urn:li:member:{conn.get('urnId', '')}"
        first = profile.get("firstName", "")
        last = profile.get("lastName", "")
        public_id = profile.get("publicIdentifier", "")
        items.append({
            "urn": conn_urn,
            "profileUrl": f"https://www.linkedin.com/in/{public_id}" if public_id else "",
            "fullName": f"{first} {last}".strip(),
            "headline": profile.get("occupation", ""),
        })
    return {"connections": items, "nextCursor": None}


def handle_get_profile(client: Linkedin, urn: str) -> dict:
    urn_id = extract_urn_id(urn)
    raw = client.get_profile(urn_id=urn_id) or {}
    experience = raw.get("experience", [])
    current_exp = experience[0] if experience else {}
    company_name = current_exp.get("companyName") or ""
    company_urn = (current_exp.get("company", {}) or {}).get("entityUrn", "")
    title = current_exp.get("title") or ""
    return {
        "urn": urn,
        "fullName": f"{raw.get('firstName', '')} {raw.get('lastName', '')}".strip(),
        "headline": raw.get("headline"),
        "currentTitle": title or raw.get("headline"),
        "currentCompany": company_name,
        "currentCompanyId": company_urn,
        "location": raw.get("locationName"),
        "profilePicUrl": None,
    }


def handle_send_message(_client: Linkedin, urn: str, body: str, profile_url: str = "") -> dict:
    """Send a LinkedIn message via browser automation (most reliable approach)."""
    import asyncio
    asyncio.run(_browser_send_message(profile_url or _profile_url_from_urn(urn), body))
    return {"messageId": f"sent-{extract_urn_id(urn)}"}


def _profile_url_from_urn(urn: str) -> str:
    slug = extract_urn_id(urn)
    return f"https://www.linkedin.com/in/{slug}/"


async def _browser_send_message(profile_url: str, body: str) -> None:
    import os, random
    from pathlib import Path
    from patchright.async_api import async_playwright

    profile_dir = Path(os.environ.get("LINKEDIN_PROFILE_DIR", "~/.linkedin-mcp/profile")).expanduser()
    headless = os.environ.get("LINKEDIN_HEADLESS", "1") == "1"

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            str(profile_dir), headless=headless,
            viewport={"width": 1280, "height": 900},
        )
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        try:
            await page.goto(profile_url.rstrip("/") + "/", wait_until="domcontentloaded", timeout=30_000)
            if "/login" in page.url or "/checkpoint" in page.url:
                raise RuntimeError("LinkedIn session expired. Re-connect via the app.")

            # Click the Message button on the profile
            await page.wait_for_timeout(random.randint(1500, 2500))
            msg_btn = page.get_by_role("button", name="Message").first
            await msg_btn.wait_for(timeout=10_000)
            await msg_btn.click()

            # Wait for message compose box
            compose = page.locator("div.msg-form__contenteditable, div[contenteditable=true][role=textbox]").first
            await compose.wait_for(timeout=10_000)
            await compose.click()
            await compose.fill(body)
            await page.wait_for_timeout(random.randint(500, 1000))

            # Send
            send_btn = page.get_by_role("button", name="Send").first
            await send_btn.click()
            await page.wait_for_timeout(1000)
        finally:
            await ctx.close()


def handle_validate(client: Linkedin) -> dict:
    try:
        client.get_user_profile()
        return {"valid": True}
    except Exception:
        return {"valid": False}


def main():
    try:
        client = build_client()
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            name = cmd.get("cmd")
            if name == "get_connections":
                result = handle_get_connections(client)
            elif name == "get_profile":
                result = handle_get_profile(client, cmd["urn"])
            elif name == "send_message":
                result = handle_send_message(client, cmd["urn"], cmd["body"])
            elif name == "validate":
                result = handle_validate(client)
            else:
                result = {"error": f"Unknown command: {name}"}
        except Exception:
            result = {"error": traceback.format_exc()}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
