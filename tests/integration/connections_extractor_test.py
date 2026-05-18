from pathlib import Path
import sys

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

from lib.linkedin.extractor import extract_connections

FIXTURE = ROOT / "tests" / "fixtures" / "linkedin-connections-page.html"


def test_extracts_all_connections_from_fixture():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    assert len(connections) >= 10, f"Expected at least 10 connections, got {len(connections)}"
    first = connections[0]
    assert first["fullName"], "fullName must be non-empty"
    assert first["profileUrl"].startswith("https://www.linkedin.com/in/"), f"got {first['profileUrl']}"
    assert "urn" in first


def test_dedupes_image_and_name_links_for_same_connection():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    urls = [c["profileUrl"] for c in connections]
    assert len(urls) == len(set(urls)), "Each connection must appear exactly once"


def test_extracts_test_person_one_and_two_from_scrubbed_fixture():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    names = [c["fullName"] for c in connections]
    assert "Test Person One" in names, f"names: {names}"
    assert "Test Person Two" in names, f"names: {names}"


def test_extracts_headline():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    with_headlines = [c for c in connections if c["headline"]]
    assert len(with_headlines) >= 5, "At least half of connections should have headlines"


def test_returns_empty_list_for_empty_html():
    assert extract_connections("<html></html>") == []


def test_constructs_stable_urn_from_public_id():
    html = FIXTURE.read_text()
    connections = extract_connections(html)
    for c in connections:
        assert c["urn"].startswith("urn:li:fs_miniProfile:"), f"got {c['urn']}"
        assert c["urn"] != "urn:li:fs_miniProfile:"
