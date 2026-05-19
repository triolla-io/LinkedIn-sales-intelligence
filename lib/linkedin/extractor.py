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
import re
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


_SEP_PATTERNS = [
    r"\s+at\s+",
    r"\s+@\s*",
    r"@",
    r"\s+בחברה\s+",
    r"\s+chez\s+",
    r"\s+bei\s+",
]
_SEPARATOR_RE = re.compile("|".join(f"(?:{p})" for p in _SEP_PATTERNS))


def parse_company_from_headline(headline: str) -> tuple[str, str]:
    """
    Best-effort split of a LinkedIn headline into (title, company).
    Examples:
      'CEO at Acme'                 → ('CEO', 'Acme')
      'Talent Partner @ Hello Heart'→ ('Talent Partner', 'Hello Heart')
      'Sourcing specialist@Scoutech'→ ('Sourcing specialist', 'Scoutech')
      'Software Engineer'           → ('Software Engineer', '')
    Company portion is truncated at common separators (|, ,, • , -).
    """
    if not headline:
        return ("", "")
    parts = _SEPARATOR_RE.split(headline, maxsplit=1)
    if len(parts) < 2:
        return (headline.strip(), "")
    title = parts[0].strip()
    rest = parts[1].strip()
    company = re.split(r"\s*[|•,\-—]\s*", rest, maxsplit=1)[0].strip()
    return (title, company)


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

        # p[2] on some cards is the company name shown separately from the headline
        company_line = ""
        if len(text_paragraphs) > 2:
            company_line = text_paragraphs[2].get_text(strip=True)

        existing = by_url.get(clean_url)
        if existing and existing["fullName"] and existing["headline"]:
            continue

        title, company = parse_company_from_headline(headline)
        # If headline parsing didn't yield a company, try the dedicated company line
        if not company and company_line:
            company = company_line

        by_url[clean_url] = {
            "urn": f"urn:li:fs_miniProfile:{public_id}",
            "profileUrl": clean_url + "/",
            "fullName": full_name,
            "headline": headline,
            "currentTitle": title,
            "currentCompany": company,
        }

    return list(by_url.values())
