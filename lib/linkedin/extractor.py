"""
Pure HTML parser for LinkedIn's /mynetwork/invite-connect/connections/ page.
No browser, no network — takes raw HTML and returns structured dicts.

LinkedIn ships two layouts and obfuscates CSS class names, but stable
data-* attributes are reliable selectors:
  data-view-name="connections-profile"  — anchors wrapping each profile

Each connection appears twice (image link + name-and-headline link), so the
extractor dedupes by href.
"""

from __future__ import annotations
from typing import Any
from urllib.parse import urlparse
from bs4 import BeautifulSoup


def _public_id_from_url(href: str) -> str:
    """https://www.linkedin.com/in/jane-doe/?...  →  jane-doe"""
    path = urlparse(href).path.rstrip("/")
    parts = path.split("/")
    if len(parts) >= 2 and parts[-2] == "in":
        return parts[-1]
    return ""


def extract_connections(html: str) -> list[dict[str, Any]]:
    """Parse LinkedIn's connections page HTML. Returns [] if no matches."""
    soup = BeautifulSoup(html, "html.parser")

    anchors = soup.find_all("a", attrs={"data-view-name": "connections-profile"})
    by_url: dict[str, dict[str, Any]] = {}

    for a in anchors:
        href = a.get("href", "")
        if not href.startswith("http"):
            continue
        clean_url = href.split("?")[0].rstrip("/")
        public_id = _public_id_from_url(clean_url)
        if not public_id:
            continue

        text_paragraphs = a.find_all("p")
        if not text_paragraphs:
            continue

        full_name = text_paragraphs[0].get_text(strip=True)
        if not full_name:
            continue

        headline = ""
        if len(text_paragraphs) > 1:
            headline = text_paragraphs[1].get_text(strip=True)

        existing = by_url.get(clean_url)
        if existing and existing["fullName"] and existing["headline"]:
            continue

        by_url[clean_url] = {
            "urn": f"urn:li:fs_miniProfile:{public_id}",
            "profileUrl": clean_url + "/",
            "fullName": full_name,
            "headline": headline,
        }

    return list(by_url.values())
