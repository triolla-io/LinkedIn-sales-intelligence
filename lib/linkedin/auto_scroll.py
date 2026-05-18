"""
Scroll-driver that loads lazy content until the visible item count stops
growing. Pure logic — accepts callables, not a Page object, so it can be
tested without Playwright.
"""

from __future__ import annotations
from typing import Awaitable, Callable


async def scroll_until_stable(
    scroll_once: Callable[[], Awaitable[None]],
    count_items: Callable[[], Awaitable[int]],
    *,
    max_scrolls: int = 100,
    stable_rounds: int = 3,
) -> int:
    """
    Repeatedly call scroll_once and check count_items. Returns when the count
    has not increased for `stable_rounds` consecutive scrolls, or when
    max_scrolls is hit. Returns the final item count.
    """
    previous = await count_items()
    stable_streak = 0
    for _ in range(max_scrolls):
        await scroll_once()
        current = await count_items()
        if current == previous:
            stable_streak += 1
            if stable_streak >= stable_rounds:
                return current
        else:
            stable_streak = 0
        previous = current
    return previous
