from __future__ import annotations
import asyncio
from playwright.async_api import Page


async def wait_for_initial_load(page: Page) -> None:
    await page.wait_for_load_state('domcontentloaded')
    try:
        await asyncio.wait_for(
            asyncio.shield(asyncio.ensure_future(page.wait_for_load_state('networkidle'))),
            timeout=3.0
        )
    except (asyncio.TimeoutError, Exception):
        pass
