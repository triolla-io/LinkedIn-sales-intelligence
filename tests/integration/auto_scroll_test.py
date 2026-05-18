import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

from lib.linkedin.auto_scroll import scroll_until_stable


class FakePage:
    """Simulates a page where each scroll loads `batch` more items, up to `total`."""

    def __init__(self, total: int = 237, batch: int = 50):
        self.total = total
        self.batch = batch
        self.loaded = batch
        self.scrolls = 0

    async def scroll_once(self):
        self.scrolls += 1
        self.loaded = min(self.loaded + self.batch, self.total)

    async def count_items(self) -> int:
        return self.loaded


def test_stops_when_no_new_items_loaded():
    page = FakePage(total=237, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, stable_rounds=2))
    assert page.loaded == 237


def test_respects_max_scrolls():
    page = FakePage(total=10000, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, max_scrolls=5, stable_rounds=2))
    assert page.scrolls == 5


def test_stable_rounds_threshold():
    page = FakePage(total=100, batch=50)
    asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, stable_rounds=3))
    assert page.scrolls == 4


def test_returns_final_count():
    page = FakePage(total=237, batch=50)
    final = asyncio.run(scroll_until_stable(page.scroll_once, page.count_items, stable_rounds=2))
    assert final == 237
