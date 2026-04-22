from __future__ import annotations
import asyncio
import sys
import subprocess
from pathlib import Path

from ...core.errors import BrowserPlatformError
from ...daemon.client import get_daemon_status, read_running_daemon_info
from ...daemon.state_store import get_default_state_store


async def _is_daemon_reachable() -> bool:
    try:
        await get_daemon_status()
        return True
    except Exception:
        return False


def _spawn_daemon() -> None:
    subprocess.Popen(
        [sys.executable, '-m', 'browser_platform.daemon.entry'],
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def handle_daemon_ensure() -> dict:
    if await _is_daemon_reachable():
        status = await get_daemon_status()
        return {'ok': True, 'daemon': {**status['daemon'], 'alreadyRunning': True}}

    get_default_state_store().ensure()
    _spawn_daemon()

    timeout_at = asyncio.get_event_loop().time() + 5.0
    while asyncio.get_event_loop().time() < timeout_at:
        if await _is_daemon_reachable():
            status = await get_daemon_status()
            return {'ok': True, 'daemon': {**status['daemon'], 'alreadyRunning': False}}
        await asyncio.sleep(0.1)

    raise BrowserPlatformError('Timed out waiting for daemon to start', code='DAEMON_START_TIMEOUT')


async def handle_daemon_status() -> dict:
    info = get_default_state_store().read_daemon_info()
    if not info:
        return {
            'ok': True,
            'daemon': {
                'running': False, 'pid': None, 'port': None, 'startedAt': None,
                'uptimeMs': None, 'sessionCount': 0, 'version': None,
            },
        }

    if not await _is_daemon_reachable():
        return {
            'ok': True,
            'daemon': {
                'running': False, 'pid': info['pid'], 'port': info['port'],
                'startedAt': info['startedAt'], 'uptimeMs': None,
                'sessionCount': 0, 'version': info.get('version'),
            },
        }

    status = await get_daemon_status()
    return {'ok': True, 'daemon': {'running': True, **status['daemon']}}


async def handle_daemon_run() -> None:
    info = await read_running_daemon_info()
    raise BrowserPlatformError(
        f"Daemon already running on port {info['port']}", code='DAEMON_ALREADY_RUNNING'
    )
