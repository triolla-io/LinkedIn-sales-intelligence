"""Tests the _parse_company helper against a real fixture."""
import sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from lib.linkedin.voyager_companies import _parse_company


def _fixture() -> dict:
    return json.loads((ROOT / "tests/fixtures/voyager-companies-sample.json").read_text())


def test_parse_microsoft():
    data = _fixture()
    result = _parse_company("microsoft", data)
    assert result["universalName"] == "microsoft"
    assert result["name"] == "Microsoft"
    assert isinstance(result["staffCount"], int)
    assert result["staffCount"] > 100_000
    assert "Software Development" in result["industries"]
    assert result["industry"] == "Software Development"
    assert result["description"]


def test_parse_empty_response():
    result = _parse_company("ghost-co", {})
    assert result is None
