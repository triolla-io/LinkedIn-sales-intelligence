import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

from lib.linkedin.extractor import parse_company_from_headline


def test_extracts_company_after_at():
    assert parse_company_from_headline("CEO at Acme") == ("CEO", "Acme")


def test_extracts_company_after_at_symbol_with_space():
    assert parse_company_from_headline("Talent Partner @ Hello Heart") == ("Talent Partner", "Hello Heart")


def test_extracts_company_after_at_symbol_no_space():
    assert parse_company_from_headline("Sourcing specialist@Scoutech") == ("Sourcing specialist", "Scoutech")


def test_returns_empty_company_when_no_separator():
    assert parse_company_from_headline("Software Engineer") == ("Software Engineer", "")


def test_truncates_company_at_pipe():
    assert parse_company_from_headline("Co-Founder & CEO at SEVEN | Building AI") == ("Co-Founder & CEO", "SEVEN")


def test_truncates_company_at_comma():
    assert parse_company_from_headline("HR Manager at Check Point, Ltd.") == ("HR Manager", "Check Point")


def test_handles_empty_string():
    assert parse_company_from_headline("") == ("", "")


def test_handles_hebrew_at():
    title, company = parse_company_from_headline("Inspector בחברה Foo")
    assert title == "Inspector"
    assert company == "Foo"
