from __future__ import annotations
import json

from ...core.errors import BrowserPlatformError
from ...daemon.types import SESSION_BACKENDS
from ...daemon.client import (
    act_in_session,
    close_session,
    get_session_context,
    observe_session,
    open_session,
    snapshot_session,
)
from ..argv import require_flag, optional_flag
from .daemon import handle_daemon_ensure

_ALLOWED_BACKENDS_TEXT = ', '.join(SESSION_BACKENDS)


async def handle_session_open(args: list[str]) -> dict:
    await handle_daemon_ensure()
    url = require_flag(args, '--url')
    storage_state_path = optional_flag(args, '--storage-state')
    profile_id = optional_flag(args, '--profile')
    scenario_id = optional_flag(args, '--scenario')
    backend = _resolve_backend(args)
    return await open_session(
        url,
        storage_state_path=storage_state_path,
        backend=backend,
        profile_id=profile_id,
        scenario_id=scenario_id,
    )


def _resolve_backend(args: list[str]) -> str:
    try:
        index = args.index('--backend')
    except ValueError:
        return 'camoufox'

    if index >= len(args) - 1:
        raise BrowserPlatformError(
            f'--backend requires a value. Allowed values: {_ALLOWED_BACKENDS_TEXT}',
            code='INVALID_BACKEND',
        )
    raw = args[index + 1].lower()
    if raw in SESSION_BACKENDS:
        return raw
    raise BrowserPlatformError(
        f'Unsupported backend. Allowed values: {_ALLOWED_BACKENDS_TEXT}',
        code='INVALID_BACKEND',
    )


async def handle_session_context(args: list[str]) -> dict:
    session_id = require_flag(args, '--session')
    return await get_session_context(session_id)


async def handle_session_observe(args: list[str]) -> dict:
    session_id = require_flag(args, '--session')
    return await observe_session(session_id)


async def handle_session_act(args: list[str]) -> dict:
    session_id = require_flag(args, '--session')
    raw_json = require_flag(args, '--json')
    try:
        payload = json.loads(raw_json)
    except Exception as exc:
        raise BrowserPlatformError(
            'Invalid action payload JSON',
            code='INVALID_JSON_PAYLOAD',
            details={'cause': str(exc)},
        ) from exc

    if not isinstance(payload, dict) or 'action' not in payload:
        raise BrowserPlatformError(
            'Action payload must contain an action field', code='INVALID_ACTION_PAYLOAD'
        )
    return await act_in_session(session_id, payload)


async def handle_session_snapshot(args: list[str]) -> dict:
    session_id = require_flag(args, '--session')
    return await snapshot_session(session_id)


async def handle_session_close(args: list[str]) -> dict:
    session_id = require_flag(args, '--session')
    return await close_session(session_id)
