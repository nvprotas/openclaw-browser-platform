from __future__ import annotations
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from ..playwright.auth_state import infer_auth_state
from ..helpers.payment_context import create_empty_payment_context

DEFAULT_LITRES_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json'
DEFAULT_SBER_COOKIES_PATH = '/root/.openclaw/workspace/sber-cookies.json'
DEFAULT_LITRES_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/litres'
DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL = 'https://www.litres.ru/auth/login/'
REPO_OWNED_LITRES_BOOTSTRAP = 'repo:browser_platform/daemon/litres_auth.py'


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_exists(path: str) -> bool:
    return Path(path).exists()


def _ensure_dir(directory: str) -> None:
    Path(directory).mkdir(parents=True, exist_ok=True)


def classify_litres_bootstrap_page(url: str, body_text: str) -> str:
    lower_url = url.lower()
    lower_text = body_text.lower()

    if 'id.sber.ru' in lower_url:
        return 'handoff_sberid'

    if 'litres.ru/auth_proxy/' in lower_url or 'litres.ru/callbacks/social-auth' in lower_url:
        return 'intermediate_auth'

    if 'litres.ru' in lower_url:
        inferred = infer_auth_state(url, {
            'url': url,
            'title': '',
            'readyState': 'complete',
            'viewport': {'width': 0, 'height': 0},
            'visibleTexts': [body_text],
            'visibleButtons': [],
            'forms': [],
            'urlHints': [],
            'pageSignatureGuess': 'auth_form' if any(
                kw in lower_text for kw in ('войти', 'пароль', 'sign in', 'log in')
            ) else 'content_page',
            'paymentContext': create_empty_payment_context(),
        })

        if inferred['state'] == 'authenticated':
            return 'authenticated_litres'
        if inferred['state'] == 'login_gate_detected':
            return 'login_gate_litres'
        return 'anonymous_litres'

    return 'external_other'


async def _timed_step(timeline: list, step: str, fn, detail: str | None = None):
    started_at = _iso_now()
    started_ms = _now_ms()
    try:
        result = await fn() if asyncio.iscoroutinefunction(fn) else fn()
        timeline.append({
            'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(),
            'durationMs': _now_ms() - started_ms, 'status': 'ok', 'detail': detail,
        })
        return result
    except Exception as exc:
        timeline.append({
            'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(),
            'durationMs': _now_ms() - started_ms, 'status': 'error', 'detail': str(exc),
        })
        raise


def _now_ms() -> float:
    import time
    return time.time() * 1000


def _finished_result(started_ms: float, timeline: list, result: dict) -> dict:
    return {**result, 'durationMs': _now_ms() - started_ms, 'timeline': timeline}


async def _wait_for_litres_bootstrap_outcome(page, timeline: list, out_dir: str,
                                              debug_screenshots: bool, screenshots: list) -> dict:
    started_at = _iso_now()
    started_ms = _now_ms()
    last_url = page.url
    last_text = ''
    last_state = 'external_other'

    while _now_ms() - started_ms < 45_000:
        try:
            await page.wait_for_load_state('domcontentloaded', timeout=5_000)
        except Exception:
            pass
        await page.wait_for_timeout(1_000)

        last_url = page.url
        try:
            last_text = await page.locator('body').inner_text()
        except Exception:
            last_text = ''
        last_state = classify_litres_bootstrap_page(last_url, last_text)

        if last_state == 'authenticated_litres':
            break

    if debug_screenshots:
        shot_path = str(Path(out_dir) / '03-after-sber-click.png')
        await page.screenshot(path=shot_path, full_page=True)
        screenshots.append(shot_path)

    raw_status = {
        'handoff_sberid': 'redirected-to-sberid',
        'authenticated_litres': 'authenticated-on-litres',
        'intermediate_auth': 'auth-proxy-timeout',
        'login_gate_litres': 'returned-to-login-gate',
        'anonymous_litres': 'returned-anonymous',
    }.get(last_state, 'external-other')

    timeline.append({
        'step': 'wait_auth_flow_outcome', 'startedAt': started_at, 'finishedAt': _iso_now(),
        'durationMs': _now_ms() - started_ms, 'status': 'ok',
        'detail': f'{last_state}:{last_url}',
    })
    return {'finalUrl': last_url, 'bodyText': last_text, 'pageState': last_state, 'rawStatus': raw_status}


async def run_integrated_litres_bootstrap(
    *,
    matched_pack: dict | None = None,
    storage_state_path: str | None = None,
    cookies_path: str | None = None,
    out_dir: str | None = None,
    headed: bool = False,
    debug_screenshots: bool = False,
    existing_page=None,
) -> dict:
    from ..playwright.browser_session import launch_camoufox_browser

    started_ms = _now_ms()
    timeline: list = []

    if not matched_pack or matched_pack.get('summary', {}).get('siteId') != 'litres':
        return _finished_result(started_ms, timeline, {
            'attempted': False, 'ok': False, 'status': 'not_applicable',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
            'usedExistingPage': False, 'scriptPath': None, 'statePath': storage_state_path,
            'outDir': None, 'finalUrl': None, 'rawStatus': None, 'errorMessage': None,
            'adoptedSession': None,
        })

    cookies_file = str(Path(cookies_path or DEFAULT_SBER_COOKIES_PATH).resolve())
    resolved_out_dir = str(Path(out_dir or DEFAULT_LITRES_BOOTSTRAP_OUT_DIR).resolve())

    has_cookies = await _timed_step(timeline, 'check_cookies_file',
                                    lambda: file_exists(cookies_file), cookies_file)
    if not has_cookies:
        return _finished_result(started_ms, timeline, {
            'attempted': True, 'ok': False, 'status': 'skipped_missing_cookies',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': True,
            'usedExistingPage': False, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
            'statePath': storage_state_path, 'outDir': resolved_out_dir,
            'finalUrl': None, 'rawStatus': None, 'errorMessage': 'Sber cookies file is missing',
            'adoptedSession': None,
        })

    state_path = str(Path(storage_state_path or DEFAULT_LITRES_STORAGE_STATE).resolve())
    screenshots: list = []
    _ensure_dir(resolved_out_dir)
    _ensure_dir(str(Path(state_path).parent))

    def _read_cookies():
        return json.loads(Path(cookies_file).read_text('utf-8'))

    cookies = await _timed_step(timeline, 'read_cookies', _read_cookies, cookies_file)

    browser = None
    context = None
    page = None
    stop_camoufox = None
    adopted_session = None
    using_existing_page = existing_page is not None

    try:
        if existing_page:
            page = existing_page
            context = page.context
        else:
            launched = await _timed_step(timeline, 'launch_camoufox', launch_camoufox_browser)
            browser = launched['browser']
            stop_camoufox = launched['stop']

            reused_saved_state = await _timed_step(timeline, 'check_existing_state',
                                                    lambda: file_exists(state_path), state_path)
            ctx_opts: dict = {'viewport': {'width': 1440, 'height': 1200}}
            if reused_saved_state:
                ctx_opts['storage_state'] = state_path
            context = await _timed_step(
                timeline, 'create_context',
                lambda: browser.new_context(**ctx_opts),
                'reuse_saved_state' if reused_saved_state else 'fresh_context',
            )
            page = await _timed_step(timeline, 'create_page', context.new_page)

        live_page = page
        live_context = context

        await _timed_step(timeline, 'inject_cookies', lambda: live_context.add_cookies(cookies))
        await _timed_step(timeline, 'persist_initial_state',
                          lambda: live_context.storage_state(path=state_path), state_path)

        await _timed_step(
            timeline, 'goto_litres_login',
            lambda: live_page.goto(DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL, wait_until='commit', timeout=60000),
            DEFAULT_LITRES_BOOTSTRAP_ENTRY_URL,
        )
        await _timed_step(timeline, 'stabilize_login_page', lambda: live_page.wait_for_timeout(3000))

        if debug_screenshots:
            shot = str(Path(resolved_out_dir) / '01-login-page.png')
            await live_page.screenshot(path=shot, full_page=True)
            screenshots.append(shot)

        after_login_url = live_page.url
        try:
            after_login_text = await live_page.locator('body').inner_text()
        except Exception:
            after_login_text = ''
        after_login_state = classify_litres_bootstrap_page(after_login_url, after_login_text)

        if after_login_state == 'authenticated_litres':
            await _timed_step(timeline, 'persist_final_state',
                              lambda: live_context.storage_state(path=state_path), state_path)
            return _finished_result(started_ms, timeline, {
                'attempted': True, 'ok': True, 'status': 'state_refreshed',
                'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'usedExistingPage': using_existing_page, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
                'statePath': state_path, 'outDir': resolved_out_dir,
                'finalUrl': after_login_url, 'rawStatus': 'already-authenticated',
                'errorMessage': None, 'adoptedSession': None,
            })

        sber_icon = live_page.locator('img[alt="sb"]').first

        async def _check_sber_direct():
            try:
                await sber_icon.wait_for(state='visible', timeout=3000)
                return True
            except Exception:
                return False

        has_sber_directly = await _timed_step(timeline, 'check_sber_icon_direct', _check_sber_direct)

        if not has_sber_directly:
            other_ways = live_page.locator('text=Другие способы').first

            async def _check_other_ways():
                try:
                    await other_ways.wait_for(state='visible', timeout=3000)
                    return True
                except Exception:
                    return False

            has_other_ways = await _timed_step(timeline, 'check_other_ways', _check_other_ways)

            if has_other_ways:
                await _timed_step(timeline, 'click_other_ways', lambda: other_ways.click(timeout=10000))
                await _timed_step(timeline, 'stabilize_other_ways', lambda: live_page.wait_for_timeout(1500))
                if debug_screenshots:
                    shot = str(Path(resolved_out_dir) / '02-other-ways.png')
                    await live_page.screenshot(path=shot, full_page=True)
                    screenshots.append(shot)
            else:
                more_button = live_page.locator('button:has-text("...")').first

                async def _check_more():
                    try:
                        await more_button.wait_for(state='visible', timeout=3000)
                        return True
                    except Exception:
                        return False

                has_more = await _timed_step(timeline, 'check_more_button', _check_more)
                if has_more:
                    await _timed_step(timeline, 'click_more_socials', lambda: more_button.click(timeout=10000))
                    await _timed_step(timeline, 'stabilize_more_socials', lambda: live_page.wait_for_timeout(1500))
                    if debug_screenshots:
                        shot = str(Path(resolved_out_dir) / '02-more-socials.png')
                        await live_page.screenshot(path=shot, full_page=True)
                        screenshots.append(shot)

        await _timed_step(timeline, 'wait_sber_icon',
                          lambda: sber_icon.wait_for(state='visible', timeout=30000))

        import re as _re

        async def _click_sber():
            await asyncio.gather(
                live_page.wait_for_url(
                    lambda u: bool(_re.search(r'id\.sber\.ru|callbacks/social-auth|litres\.ru', u, _re.IGNORECASE)),
                    timeout=20000,
                ),
                sber_icon.click(timeout=10000),
                return_exceptions=True,
            )

        await _timed_step(timeline, 'click_sber_login', _click_sber)

        auth_flow = await _wait_for_litres_bootstrap_outcome(
            live_page, timeline, resolved_out_dir, debug_screenshots, screenshots
        )
        await _timed_step(timeline, 'persist_final_state',
                          lambda: live_context.storage_state(path=state_path), state_path)
        Path(resolved_out_dir, 'page.txt').write_text(auth_flow['bodyText'] or '', 'utf-8')
        await _timed_step(timeline, 'check_final_state', lambda: file_exists(state_path), state_path)

        if auth_flow['pageState'] == 'handoff_sberid':
            if not using_existing_page:
                adopted_session = {
                    'browser': browser, 'context': live_context, 'page': live_page,
                    'stop': stop_camoufox or (lambda: None),
                }
            return _finished_result(started_ms, timeline, {
                'attempted': True, 'ok': True, 'status': 'redirected_to_sberid',
                'handoffRequired': True, 'redirectedToSberId': True, 'bootstrapFailed': False,
                'usedExistingPage': using_existing_page, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
                'statePath': state_path, 'outDir': resolved_out_dir,
                'finalUrl': auth_flow['finalUrl'], 'rawStatus': auth_flow['rawStatus'],
                'errorMessage': None, 'adoptedSession': adopted_session,
            })

        if auth_flow['pageState'] == 'authenticated_litres':
            if not using_existing_page:
                adopted_session = {
                    'browser': browser, 'context': live_context, 'page': live_page,
                    'stop': stop_camoufox or (lambda: None),
                }
            return _finished_result(started_ms, timeline, {
                'attempted': True, 'ok': True, 'status': 'state_refreshed',
                'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'usedExistingPage': using_existing_page, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
                'statePath': state_path, 'outDir': resolved_out_dir,
                'finalUrl': auth_flow['finalUrl'], 'rawStatus': auth_flow['rawStatus'],
                'errorMessage': None, 'adoptedSession': adopted_session,
            })

        page_state = auth_flow['pageState']
        error_messages = {
            'intermediate_auth': 'Bootstrap stopped on an intermediate LitRes auth page without reaching Sber ID or authenticated LitRes',
            'login_gate_litres': 'Bootstrap returned to LitRes login gate without finishing authentication',
            'anonymous_litres': 'Bootstrap returned to LitRes without authenticated signals',
        }
        return _finished_result(started_ms, timeline, {
            'attempted': True, 'ok': False, 'status': 'failed',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': True,
            'usedExistingPage': using_existing_page, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
            'statePath': state_path, 'outDir': resolved_out_dir,
            'finalUrl': auth_flow['finalUrl'], 'rawStatus': auth_flow['rawStatus'],
            'errorMessage': error_messages.get(page_state, f"Bootstrap finished on an unsupported page: {auth_flow['finalUrl']}"),
            'adoptedSession': None,
        })

    except Exception as exc:
        error_shot = str(Path(resolved_out_dir) / 'error.png')
        if page:
            try:
                await page.screenshot(path=error_shot, full_page=True)
                screenshots.append(error_shot)
            except Exception:
                pass
        return _finished_result(started_ms, timeline, {
            'attempted': True, 'ok': False, 'status': 'failed',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': True,
            'usedExistingPage': using_existing_page, 'scriptPath': REPO_OWNED_LITRES_BOOTSTRAP,
            'statePath': state_path if 'state_path' in dir() else storage_state_path,
            'outDir': resolved_out_dir,
            'finalUrl': page.url if page else None, 'rawStatus': None,
            'errorMessage': str(exc), 'adoptedSession': None,
        })
    finally:
        if not using_existing_page and not adopted_session:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            tasks = []
            if browser:
                tasks.append(asyncio.ensure_future(_safe_close(browser)))
            if stop_camoufox:
                tasks.append(asyncio.ensure_future(_safe_stop(stop_camoufox)))
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)


async def _safe_close(obj) -> None:
    try:
        await obj.close()
    except Exception:
        pass


async def _safe_stop(fn) -> None:
    try:
        result = fn()
        if asyncio.iscoroutine(result):
            await result
    except Exception:
        pass
