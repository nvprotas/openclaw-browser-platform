from __future__ import annotations
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.async_api import Page


def is_debug_enabled() -> bool:
    return os.environ.get('BROWSER_PLATFORM_DEBUG') == '1'


def get_debug_log_path(root_dir: str) -> Path:
    return Path(root_dir) / 'artifacts' / 'debug' / 'browser-platform.log'


def append_debug_log(root_dir: str, entry: dict[str, Any]) -> None:
    log_path = get_debug_log_path(root_dir)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).isoformat()
    line = json.dumps({'ts': ts, **entry}) + '\n'
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(line)


def capture_debug_step_json(root_dir: str, session_id: str, step_name: str, meta: Any) -> str:
    ts = datetime.now(timezone.utc).isoformat().replace(':', '-').replace('.', '-')
    step_dir = Path(root_dir) / 'artifacts' / 'debug' / session_id / f'{ts}-{step_name}'
    step_dir.mkdir(parents=True, exist_ok=True)
    (step_dir / 'step.json').write_text(json.dumps(meta, indent=2) + '\n', 'utf-8')
    return str(step_dir)


async def capture_debug_step(page: 'Page', root_dir: str, session_id: str, step_name: str, meta: Any) -> str:
    ts = datetime.now(timezone.utc).isoformat().replace(':', '-').replace('.', '-')
    step_dir = Path(root_dir) / 'artifacts' / 'debug' / session_id / f'{ts}-{step_name}'
    step_dir.mkdir(parents=True, exist_ok=True)
    await page.screenshot(path=str(step_dir / 'page.png'), full_page=True)
    (step_dir / 'step.json').write_text(json.dumps(meta, indent=2) + '\n', 'utf-8')
    return str(step_dir)
