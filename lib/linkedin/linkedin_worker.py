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


def resolve_profile_id(client: Linkedin, urn: str) -> str:
    """Return the base64 profile ID needed by the messaging API.

    The stored URN may contain either:
    - A real base64 profile ID: urn:li:fs_miniProfile:ACoAABcJ...  (starts with ACo, 20+ chars)
    - A vanity slug from HTML scraping: urn:li:fs_miniProfile:yuvalbaror1
    - A CSV import URN: urn:li:csv_import:...

    In the latter two cases we resolve via a profile lookup.
    """
    urn_id = extract_urn_id(urn)
    # Proper LinkedIn base64 profile IDs start with "ACo" and are long
    if urn_id.startswith("ACo") and len(urn_id) > 20:
        return urn_id
    # Vanity slug or import URN — resolve to actual entityUrn
    profile = client.get_profile(public_id=urn_id) or {}
    entity_urn = profile.get("entityUrn", "")
    if entity_urn:
        return extract_urn_id(entity_urn)
    raise ValueError(f"Could not resolve LinkedIn profile ID for URN: {urn}")


def handle_send_message(client: Linkedin, urn: str, body: str) -> dict:
    profile_id = resolve_profile_id(client, urn)
    error = client.send_message(message_body=body, recipients=[profile_id])
    if error is True:
        raise ValueError(f"LinkedIn API rejected the message (recipient: {profile_id})")
    return {"messageId": f"sent-{profile_id}"}


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
