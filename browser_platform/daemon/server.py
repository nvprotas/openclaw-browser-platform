from __future__ import annotations
import asyncio
import json
import os
import secrets
import time
from datetime import datetime, timezone

from aiohttp import web

from ..core.errors import BrowserPlatformError
from ..playwright.controller import PlaywrightController
from ..packs.loader import match_site_pack_by_url
from ..helpers.login_gates import detect_login_gate
from ..helpers.hard_stop import build_hard_stop_signal
from ..debug.capture import is_debug_enabled, append_debug_log
from .state_store import get_default_state_store, StateStore
from .litres_auth import run_integrated_litres_bootstrap
from .kuper_auth import run_integrated_kuper_bootstrap
from .profile_state import resolve_profile_for_session
from .backend_policy import resolve_backend_for_session
from .session_registry import SessionRegistry, DEFAULT_SESSION_IDLE_TIMEOUT_MS
from .types import SESSION_BACKENDS

VERSION = '0.1.0'
_SESSION_IDLE_TIMEOUT_ENV = 'BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS'
_DEFAULT_JANITOR_INTERVAL_MS = 60_000


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_session_backend(value: object) -> bool:
    return isinstance(value, str) and value in SESSION_BACKENDS


def resolve_session_idle_timeout_ms(env: dict | None = None, override: int | None = None) -> int:
    if override is not None:
        return override if override > 0 else DEFAULT_SESSION_IDLE_TIMEOUT_MS
    raw = (env or os.environ).get(_SESSION_IDLE_TIMEOUT_ENV, '').strip()
    if not raw:
        return DEFAULT_SESSION_IDLE_TIMEOUT_MS
    try:
        parsed = int(raw)
        return parsed if parsed > 0 else DEFAULT_SESSION_IDLE_TIMEOUT_MS
    except ValueError:
        return DEFAULT_SESSION_IDLE_TIMEOUT_MS


class _TimingCollector:
    def __init__(self) -> None:
        self.stages: list = []

    async def run(self, step: str, fn, detail: str | None = None):
        started_at = _iso_now()
        started_ms = time.time() * 1000
        try:
            result = await fn() if asyncio.iscoroutinefunction(fn) else fn()
            self.stages.append({
                'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(),
                'durationMs': time.time() * 1000 - started_ms, 'status': 'ok', 'detail': detail,
            })
            return result
        except Exception as exc:
            self.stages.append({
                'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(),
                'durationMs': time.time() * 1000 - started_ms, 'status': 'error', 'detail': str(exc),
            })
            raise

    def skip(self, step: str, detail: str) -> None:
        now = _iso_now()
        self.stages.append({
            'step': step, 'startedAt': now, 'finishedAt': now, 'durationMs': 0,
            'status': 'skipped', 'detail': detail,
        })


def _to_error_response(error: Exception) -> tuple[int, dict]:
    if isinstance(error, BrowserPlatformError):
        status = (
            404 if error.code == 'SESSION_NOT_FOUND' else
            500 if error.code == 'SESSION_OPEN_FAILED' else 400
        )
        return status, {
            'ok': False,
            'error': {'message': error.message, 'code': error.code, 'details': error.details},
        }
    return 500, {
        'ok': False,
        'error': {'message': str(error) if error else 'Unknown server error'},
    }


async def run_session_janitor_pass(registry: SessionRegistry, controller: PlaywrightController) -> None:
    expired = registry.find_expired_session_ids()
    await asyncio.gather(*(
        _close_and_forget(controller, registry, sid, 'idle_timeout')
        for sid in expired
    ), return_exceptions=True)


async def _close_and_forget(controller: PlaywrightController, registry: SessionRegistry,
                             session_id: str, reason: str) -> None:
    await controller.close_session(session_id)
    registry.close(session_id, reason)
    registry.remove(session_id)


async def start_daemon_server(
    *,
    session_idle_timeout_ms: int | None = None,
    session_janitor_interval_ms: int | None = None,
    registry: SessionRegistry | None = None,
    state_store: StateStore | None = None,
    controller: PlaywrightController | None = None,
) -> dict:
    idle_timeout_ms = resolve_session_idle_timeout_ms(override=session_idle_timeout_ms)
    _registry = registry or SessionRegistry(default_idle_timeout_ms=idle_timeout_ms)
    _state_store = state_store or get_default_state_store()
    _controller = controller or PlaywrightController(_state_store.root)
    token = secrets.token_hex(24)
    started_at = _iso_now()
    start_time = time.time()

    janitor_interval = (session_janitor_interval_ms or _DEFAULT_JANITOR_INTERVAL_MS) / 1000.0
    janitor_task: asyncio.Task | None = None
    _janitor_lock = asyncio.Lock()

    async def _run_janitor_loop():
        while True:
            await asyncio.sleep(janitor_interval)
            async with _janitor_lock:
                try:
                    await run_session_janitor_pass(_registry, _controller)
                except Exception:
                    pass

    async def _handler(request: web.Request) -> web.Response:
        auth = request.headers.get('authorization', '')
        if auth != f'Bearer {token}':
            return _json(401, {'ok': False, 'error': {'message': 'Unauthorized'}})

        request_start_ms = time.time() * 1000
        log_session_id = None
        log_payload_summary = None

        try:
            method = request.method
            path = request.path

            if method == 'GET' and path == '/v1/daemon/status':
                app_ref = request.app
                port = app_ref['_port']
                return _json(200, {
                    'ok': True,
                    'daemon': {
                        'pid': os.getpid(),
                        'port': port,
                        'startedAt': started_at,
                        'uptimeMs': round((time.time() - start_time) * 1000),
                        'sessionCount': _registry.count_open(),
                        'version': VERSION,
                    },
                })

            body = await _read_json_body(request)

            if method == 'POST' and path == '/v1/session/open':
                return await _handle_session_open(
                    body, _registry, _state_store, _controller, token,
                    idle_timeout_ms, started_at, start_time, request
                )

            if method == 'POST' and path == '/v1/session/context':
                log_session_id = (body or {}).get('sessionId')
                session = _registry.get(log_session_id) if log_session_id else None
                if not session:
                    raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
                return _json(200, {'ok': True, 'session': _registry.touch_usage(session['sessionId']) or session})

            if method == 'POST' and path == '/v1/session/observe':
                log_session_id = (body or {}).get('sessionId')
                session = _registry.get(log_session_id) if log_session_id else None
                if not session:
                    raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
                _registry.touch_usage(session['sessionId'])
                try:
                    observed = await _controller.observe_session(session['sessionId'])
                except BrowserPlatformError as err:
                    if err.code == 'SESSION_NOT_FOUND':
                        await _close_and_forget(_controller, _registry, session['sessionId'], 'controller_missing')
                    raise
                auth = detect_login_gate(observed['url'], observed)
                _registry.touch_usage(session['sessionId'], {
                    'url': observed['url'], 'title': observed['title'],
                    'authContext': {
                        **session['authContext'],
                        'state': auth['state'],
                        'loginGateDetected': auth['loginGateDetected'],
                        'authenticatedSignals': auth['authenticatedSignals'],
                        'anonymousSignals': auth['anonymousSignals'],
                    },
                    'paymentContext': observed['paymentContext'],
                })
                payload = {
                    'sessionId': session['sessionId'],
                    'observedAt': _iso_now(),
                    **observed,
                }
                hard_stop = build_hard_stop_signal(observed['url'], observed['paymentContext'])
                if hard_stop:
                    payload['hardStop'] = hard_stop
                payload['trace'] = await _controller.write_trace(session['sessionId'], 'observe', payload)
                return _json(200, {'ok': True, 'session': payload})

            if method == 'POST' and path == '/v1/session/act':
                log_session_id = (body or {}).get('sessionId')
                log_payload_summary = {'action': (body or {}).get('payload', {}).get('action')} if body else None
                session = _registry.get(log_session_id) if log_session_id else None
                if not session:
                    raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
                action_payload = (body or {}).get('payload')
                if not action_payload:
                    raise BrowserPlatformError('Missing action payload', code='INVALID_ACTION_PAYLOAD')

                terminal_ctx = session['paymentContext']
                if (terminal_ctx.get('terminalExtractionResult') or terminal_ctx.get('shouldReportImmediately')) \
                        and terminal_ctx.get('extractionJson'):
                    hard_stop = build_hard_stop_signal(session['url'], terminal_ctx)
                    return _json(409, {
                        'ok': False,
                        'code': 'HARD_STOP_TERMINAL_EXTRACTION_RESULT',
                        'message': 'Session is in terminal extraction state. Return hardStop.finalPayload to the user and do not continue browsing.',
                        'hardStop': hard_stop,
                    })

                _registry.touch_usage(session['sessionId'])
                try:
                    action = await _controller.act_in_session(session['sessionId'], action_payload)
                except BrowserPlatformError as err:
                    if err.code == 'SESSION_NOT_FOUND':
                        await _close_and_forget(_controller, _registry, session['sessionId'], 'controller_missing')
                    raise
                auth = detect_login_gate(action['after']['url'], action['after'])
                _registry.touch_usage(session['sessionId'], {
                    'url': action['after']['url'], 'title': action['after']['title'],
                    'authContext': {
                        **session['authContext'],
                        'state': auth['state'],
                        'loginGateDetected': auth['loginGateDetected'],
                        'authenticatedSignals': auth['authenticatedSignals'],
                        'anonymousSignals': auth['anonymousSignals'],
                    },
                    'paymentContext': action['after']['paymentContext'],
                })
                hard_stop = build_hard_stop_signal(action['after']['url'], action['after']['paymentContext'])
                before_hs = build_hard_stop_signal(action['before']['url'], action['before']['paymentContext'])
                payload = {
                    'sessionId': session['sessionId'],
                    'actedAt': _iso_now(),
                    'action': action['action'],
                    'target': action['target'],
                    'input': action['input'],
                    'before': {'sessionId': session['sessionId'], 'observedAt': _iso_now(), **action['before']},
                    'after': {'sessionId': session['sessionId'], 'observedAt': _iso_now(), **action['after']},
                    'changes': action['changes'],
                    'observations': action['observations'],
                }
                if before_hs:
                    payload['before']['hardStop'] = before_hs
                if hard_stop:
                    payload['after']['hardStop'] = hard_stop
                    payload['hardStop'] = hard_stop
                payload['trace'] = await _controller.write_trace(
                    session['sessionId'], f"act-{action['action']}", payload
                )
                return _json(200, {'ok': True, 'action': payload})

            if method == 'POST' and path == '/v1/session/snapshot':
                log_session_id = (body or {}).get('sessionId')
                session = _registry.get(log_session_id) if log_session_id else None
                if not session:
                    raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
                _registry.touch_usage(session['sessionId'])
                snapshot_result = await _controller.snapshot_session(session['sessionId'])
                auth = detect_login_gate(snapshot_result['state']['url'], snapshot_result['state'])
                _registry.touch_usage(session['sessionId'], {
                    'url': snapshot_result['state']['url'], 'title': snapshot_result['state']['title'],
                    'authContext': {
                        **session['authContext'],
                        'state': auth['state'],
                        'loginGateDetected': auth['loginGateDetected'],
                        'authenticatedSignals': auth['authenticatedSignals'],
                        'anonymousSignals': auth['anonymousSignals'],
                    },
                    'paymentContext': snapshot_result['state']['paymentContext'],
                })
                hard_stop = build_hard_stop_signal(
                    snapshot_result['state']['url'], snapshot_result['state']['paymentContext']
                )
                snapshot = {
                    'sessionId': session['sessionId'],
                    'capturedAt': _iso_now(),
                    'rootDir': snapshot_result['rootDir'],
                    'screenshotPath': snapshot_result['screenshotPath'],
                    'htmlPath': snapshot_result['htmlPath'],
                    'state': {'sessionId': session['sessionId'], 'observedAt': _iso_now(), **snapshot_result['state']},
                }
                if hard_stop:
                    snapshot['state']['hardStop'] = hard_stop
                    snapshot['hardStop'] = hard_stop
                snapshot['trace'] = await _controller.write_trace(session['sessionId'], 'snapshot', snapshot)
                return _json(200, {'ok': True, 'snapshot': snapshot})

            if method == 'POST' and path == '/v1/session/close':
                log_session_id = (body or {}).get('sessionId')
                session = _registry.get(log_session_id) if log_session_id else None
                if not session:
                    raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
                closed_session = _registry.close(session['sessionId'], 'manual') or session
                await _controller.close_session(session['sessionId'])
                _registry.remove(session['sessionId'])
                return _json(200, {'ok': True, 'session': closed_session})

            return _json(404, {'ok': False, 'error': {'message': 'Not found'}})

        except Exception as exc:
            status_code, payload = _to_error_response(exc)
            return _json(status_code, payload)
        finally:
            if is_debug_enabled():
                asyncio.ensure_future(append_debug_log(_state_store.root, {
                    'source': 'agent', 'event': 'request',
                    'method': request.method, 'route': request.path,
                    'sessionId': log_session_id, 'payload': log_payload_summary,
                    'durationMs': time.time() * 1000 - request_start_ms,
                }))

    app = web.Application()
    app.router.add_get('/v1/daemon/status', _handler)
    app.router.add_post('/v1/session/open', _handler)
    app.router.add_post('/v1/session/context', _handler)
    app.router.add_post('/v1/session/observe', _handler)
    app.router.add_post('/v1/session/act', _handler)
    app.router.add_post('/v1/session/snapshot', _handler)
    app.router.add_post('/v1/session/close', _handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()

    port = site._server.sockets[0].getsockname()[1]
    app['_port'] = port

    janitor_task = asyncio.ensure_future(_run_janitor_loop())

    info = {
        'pid': os.getpid(),
        'port': port,
        'token': token,
        'startedAt': started_at,
        'version': VERSION,
    }
    await _state_store.write_daemon_info(info)

    loop = asyncio.get_event_loop()

    def _handle_signal():
        async def _shutdown():
            if janitor_task:
                janitor_task.cancel()
            _registry.close_all('shutdown')
            await _controller.close_all()
            _registry.clear()
            await runner.cleanup()

        asyncio.ensure_future(_shutdown())

    try:
        loop.add_signal_handler(__import__('signal').SIGTERM, _handle_signal)
        loop.add_signal_handler(__import__('signal').SIGINT, _handle_signal)
    except (NotImplementedError, RuntimeError):
        pass

    return info


async def _handle_session_open(body, registry, state_store, controller, token,
                                idle_timeout_ms, started_at, start_time, request) -> web.Response:
    request_started_at = _iso_now()
    request_started_ms = time.time() * 1000
    timing = _TimingCollector()

    if not body or not body.get('url'):
        return _json(400, {'ok': False, 'error': {'message': 'Missing url'}})

    requested_url = body['url']
    req_backend = body.get('backend')

    if req_backend is not None and not is_session_backend(req_backend):
        return _json(400, {'ok': False, 'error': {
            'message': f"Invalid backend. Allowed values: {', '.join(SESSION_BACKENDS)}"
        }})

    pre_matched_pack = await timing.run(
        'match_site_pack_pre', lambda: match_site_pack_by_url(requested_url), requested_url
    )
    backend_policy = resolve_backend_for_session(
        requested_url=requested_url,
        matched_pack=pre_matched_pack,
        profile_id=body.get('profileId'),
        scenario_id=body.get('scenarioId'),
    )
    backend = backend_policy['selectedBackend']

    profile = await timing.run(
        'resolve_profile',
        lambda: resolve_profile_for_session(
            state_root_dir=state_store.root,
            backend=backend,
            requested_url=requested_url,
            explicit_storage_state_path=body.get('storageStatePath') or None,
            profile_id=body.get('profileId') or None,
            matched_pack=pre_matched_pack,
        ),
        body.get('profileId'),
    )

    record = registry.open(
        url=requested_url,
        backend=backend,
        scenario_id=body.get('scenarioId'),
        idle_timeout_ms=idle_timeout_ms,
        profile_context={
            'profileId': profile['profileId'],
            'persistent': profile['persistent'],
            'source': profile['source'],
            'storageStatePath': profile['storageStatePath'],
            'storageStateExists': profile['storageStateExists'],
        },
    )

    try:
        open_with_state_path = profile['storageStatePath'] if profile['storageStateExists'] else None
        opened = await timing.run(
            'open_session_initial',
            lambda: controller.open_session(
                record['sessionId'], requested_url,
                storage_state_path=open_with_state_path, backend=backend,
            ),
            open_with_state_path,
        )
        matched_pack = await timing.run(
            'match_site_pack_opened_initial', lambda: match_site_pack_by_url(opened['url']), opened['url']
        )
        observed = await timing.run(
            'observe_session_initial', lambda: controller.observe_session(record['sessionId'])
        )
        auth = detect_login_gate(opened['url'], observed)

        needs_litres_bootstrap = (
            matched_pack and matched_pack.get('summary', {}).get('siteId') == 'litres' and
            auth['state'] != 'authenticated'
        )
        needs_kuper_bootstrap = (
            matched_pack and matched_pack.get('summary', {}).get('siteId') == 'kuper' and
            auth['state'] != 'authenticated' and not profile['storageStateExists']
        )

        if needs_litres_bootstrap:
            bootstrap_result = await timing.run(
                'bootstrap_litres',
                lambda: run_integrated_litres_bootstrap(
                    matched_pack=matched_pack,
                    storage_state_path=profile['storageStatePath'],
                    existing_page=controller.get_session_page(record['sessionId']),
                ),
                profile['storageStatePath'],
            )
        elif needs_kuper_bootstrap:
            bootstrap_result = await timing.run(
                'bootstrap_kuper',
                lambda: run_integrated_kuper_bootstrap(storage_state_path=profile['storageStatePath']),
                profile['storageStatePath'],
            )
        else:
            bootstrap_result = {
                'attempted': False, 'ok': False,
                'status': 'reused_existing_state' if profile['storageStateExists'] else 'not_attempted',
                'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'usedExistingPage': False, 'scriptPath': None,
                'statePath': profile['storageStatePath'], 'outDir': None,
                'finalUrl': None, 'rawStatus': None, 'errorMessage': None,
                'durationMs': 0, 'timeline': [],
            }

        if not bootstrap_result['attempted']:
            timing.skip(
                'bootstrap_skipped',
                'existing_storage_state' if profile['storageStateExists'] else 'not_applicable',
            )

        refreshed_state_path = bootstrap_result.get('statePath') or profile['storageStatePath']
        refreshed_state_exists = (
            profile['storageStateExists'] or
            (bootstrap_result['ok'] and bool(refreshed_state_path))
        )

        if (bootstrap_result['attempted'] and bootstrap_result.get('usedExistingPage') and
                (bootstrap_result['ok'] or bootstrap_result['handoffRequired'])):
            observed = await timing.run(
                'observe_session_after_bootstrap', lambda: controller.observe_session(record['sessionId'])
            )
            opened = {'url': observed['url'], 'title': observed['title']}
            matched_pack = await timing.run(
                'match_site_pack_after_bootstrap', lambda: match_site_pack_by_url(opened['url']), opened['url']
            )
            auth = detect_login_gate(opened['url'], observed)

        elif bootstrap_result['attempted'] and bootstrap_result.get('adoptedSession'):
            opened = await timing.run(
                'adopt_bootstrap_session',
                lambda: controller.adopt_session(
                    record['sessionId'], bootstrap_result['adoptedSession'],
                    storage_state_path=refreshed_state_path, backend=backend,
                ),
                refreshed_state_path,
            )
            matched_pack = await timing.run(
                'match_site_pack_adopted', lambda: match_site_pack_by_url(opened['url']), opened['url']
            )
            observed = await timing.run(
                'observe_session_adopted', lambda: controller.observe_session(record['sessionId'])
            )
            auth = detect_login_gate(opened['url'], observed)

        elif (bootstrap_result['attempted'] and refreshed_state_path and
              (bootstrap_result['ok'] or bootstrap_result['handoffRequired'])):
            await timing.run('close_session_before_reopen', lambda: controller.close_session(record['sessionId']))
            opened = await timing.run(
                'open_session_rehydrated',
                lambda: controller.open_session(
                    record['sessionId'], requested_url,
                    storage_state_path=refreshed_state_path, backend=backend,
                ),
                refreshed_state_path,
            )
            matched_pack = await timing.run(
                'match_site_pack_opened_rehydrated', lambda: match_site_pack_by_url(opened['url']), opened['url']
            )
            observed = await timing.run(
                'observe_session_rehydrated', lambda: controller.observe_session(record['sessionId'])
            )
            auth = detect_login_gate(opened['url'], observed)
        else:
            timing.skip('reopen_after_bootstrap', 'not_needed')

        effective_pack = matched_pack or pre_matched_pack
        pack_context = (
            {
                'matchedPack': True,
                'siteId': effective_pack['summary']['siteId'],
                'supportLevel': effective_pack['summary']['supportLevel'],
                'matchedDomain': effective_pack['summary']['matchedDomain'],
                'startUrl': effective_pack['summary']['startUrl'],
                'flows': effective_pack['summary']['flows'],
                'knownRisks': effective_pack['summary'].get('riskFlags', []),
                'instructionsSummary': effective_pack['instructionsSummary'],
                'knownSignals': effective_pack['knownSignals'],
            }
            if effective_pack else record['packContext']
        )
        session = registry.touch(record['sessionId'], {
            'url': opened['url'],
            'title': opened['title'],
            'profileContext': {
                **record['profileContext'],
                'storageStatePath': refreshed_state_path,
                'storageStateExists': refreshed_state_exists,
            },
            'packContext': pack_context,
            'authContext': {
                'state': auth['state'],
                'loginGateDetected': auth['loginGateDetected'],
                'bootstrapAttempted': bool(profile['source']) or bootstrap_result['attempted'],
                'bootstrapSource': profile['source'],
                'storageStatePath': refreshed_state_path,
                'storageStateExists': refreshed_state_exists,
                'authenticatedSignals': auth['authenticatedSignals'],
                'anonymousSignals': auth['anonymousSignals'],
                'handoffRequired': bootstrap_result['handoffRequired'],
                'bootstrapFailed': bootstrap_result['bootstrapFailed'],
                'redirectedToSberId': bootstrap_result['redirectedToSberId'],
                'bootstrapStatus': bootstrap_result['status'],
                'bootstrapScriptPath': bootstrap_result.get('scriptPath'),
                'bootstrapOutDir': bootstrap_result.get('outDir'),
                'bootstrapFinalUrl': bootstrap_result.get('finalUrl'),
                'bootstrapError': bootstrap_result.get('errorMessage'),
                'bootstrapDurationMs': bootstrap_result.get('durationMs'),
                'bootstrapTimeline': bootstrap_result.get('timeline', []),
            },
            'paymentContext': observed['paymentContext'],
        }) or record

        trace = await controller.write_trace(record['sessionId'], 'session-open', {
            'sessionId': record['sessionId'],
            'requestedUrl': requested_url,
            'timing': {
                'startedAt': request_started_at,
                'finishedAt': _iso_now(),
                'durationMs': time.time() * 1000 - request_started_ms,
                'stages': timing.stages,
            },
            'opened': opened,
            'packContext': session['packContext'],
            'authContext': session['authContext'],
            'paymentContext': session['paymentContext'],
            'observedAt': _iso_now(),
            'page': observed,
        })
        return _json(200, {'ok': True, 'session': {**session, 'trace': trace}})

    except Exception:
        await _close_and_forget(controller, registry, record['sessionId'], 'open_failed')
        raise


def _json(status: int, data: object) -> web.Response:
    return web.Response(
        status=status,
        content_type='application/json',
        text=json.dumps(data) + '\n',
    )


async def _read_json_body(request: web.Request) -> dict | None:
    try:
        body = await request.read()
        if not body:
            return None
        return json.loads(body.decode('utf-8'))
    except Exception:
        return None
