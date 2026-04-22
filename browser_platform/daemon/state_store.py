from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any

_DAEMON_INFO_FILENAME = 'daemon.json'
_ENV_STATE_ROOT = 'BROWSER_PLATFORM_STATE_ROOT'


def _resolve_package_root() -> Path:
    here = Path(__file__).parent
    # browser_platform/daemon -> browser_platform -> project root
    return here.parent.parent


_DEFAULT_ROOT = _resolve_package_root() / '.tmp' / 'browser-platform'


def _resolve_default_root() -> Path:
    override = os.environ.get(_ENV_STATE_ROOT, '').strip()
    return Path(override).resolve() if override else _DEFAULT_ROOT


class StateStore:
    def __init__(self, root_dir: Path | None = None):
        self._root = root_dir if root_dir is not None else _resolve_default_root()

    @property
    def root(self) -> str:
        return str(self._root)

    @property
    def daemon_info_path(self) -> Path:
        return self._root / _DAEMON_INFO_FILENAME

    def ensure(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def read_daemon_info(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.daemon_info_path.read_text('utf-8'))
        except Exception:
            return None

    def write_daemon_info(self, info: dict[str, Any]) -> None:
        self.ensure()
        self.daemon_info_path.write_text(json.dumps(info, indent=2) + '\n', 'utf-8')


def get_default_state_store() -> StateStore:
    return StateStore()
