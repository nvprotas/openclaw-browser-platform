from __future__ import annotations
import json
from urllib.request import urlopen, Request
from urllib.error import HTTPError

from ..core.errors import BrowserPlatformError
from .state_store import get_default_state_store


async def read_running_daemon_info() -> dict:
    info = get_default_state_store().read_daemon_info()
    if not info:
        raise BrowserPlatformError('Daemon is not initialized', code='DAEMON_NOT_INITIALIZED')
    return info


def _request(info: dict, route: str, body: object | None = None) -> dict:
    url = f"http://127.0.0.1:{info['port']}{route}"
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {
        'content-type': 'application/json',
        'authorization': f"Bearer {info['token']}",
    }
    req = Request(url, data=data, headers=headers, method='POST' if body is not None else 'GET')
    try:
        with urlopen(req) as resp:
            text = resp.read().decode('utf-8')
            return json.loads(text) if text else {}
    except HTTPError as exc:
        text = exc.read().decode('utf-8')
        try:
            payload = json.loads(text)
            error_info = payload.get('error', {})
            message = error_info.get('message', exc.reason)
            details = error_info.get('details')
        except Exception:
            message = str(exc)
            details = None
        raise BrowserPlatformError(message, code='DAEMON_REQUEST_FAILED', details=details) from exc


async def get_daemon_status() -> dict:
    return _request(await read_running_daemon_info(), '/v1/daemon/status')


async def open_session(
    url: str,
    *,
    storage_state_path: str | None = None,
    backend: str | None = None,
    profile_id: str | None = None,
    scenario_id: str | None = None,
) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/open', {
        'url': url,
        'storageStatePath': storage_state_path,
        'backend': backend,
        'profileId': profile_id,
        'scenarioId': scenario_id,
    })


async def get_session_context(session_id: str) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/context', {'sessionId': session_id})


async def observe_session(session_id: str) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/observe', {'sessionId': session_id})


async def act_in_session(session_id: str, payload: dict) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/act', {
        'sessionId': session_id,
        'payload': payload,
    })


async def snapshot_session(session_id: str) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/snapshot', {'sessionId': session_id})


async def close_session(session_id: str) -> dict:
    return _request(await read_running_daemon_info(), '/v1/session/close', {'sessionId': session_id})
