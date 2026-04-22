from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace(':', '-').replace('.', '-')


class TraceWriter:
    def __init__(self, root_dir: str):
        self._root = Path(root_dir)

    def write_step(self, session_id: str, step_type: str, payload: Any) -> dict[str, str]:
        directory = self._root / session_id
        directory.mkdir(parents=True, exist_ok=True)
        trace_path = directory / f'{_timestamp()}-{step_type}.json'
        trace_path.write_text(json.dumps(payload, indent=2) + '\n', 'utf-8')
        return {'tracePath': str(trace_path)}
