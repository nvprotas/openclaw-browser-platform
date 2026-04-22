from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from playwright.async_api import Page


async def capture_page_snapshot(page: Page, snapshot_root_dir: str, session_id: str) -> dict[str, str]:
    ts = datetime.now(timezone.utc).isoformat().replace(':', '-').replace('.', '-')
    root_dir = Path(snapshot_root_dir) / session_id / ts
    root_dir.mkdir(parents=True, exist_ok=True)

    screenshot_path = root_dir / 'page.png'
    html_path = root_dir / 'page.html'

    await page.screenshot(path=str(screenshot_path), full_page=True)
    html_path.write_text(await page.content(), 'utf-8')

    return {
        'rootDir': str(root_dir),
        'screenshotPath': str(screenshot_path),
        'htmlPath': str(html_path),
    }
