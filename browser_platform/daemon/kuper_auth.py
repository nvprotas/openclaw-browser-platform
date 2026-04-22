from __future__ import annotations
import asyncio
import json
import re
from pathlib import Path

DEFAULT_KUPER_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/kuper/storage-state.json'
DEFAULT_KUPER_BOOTSTRAP_OUT_DIR = '/root/.openclaw/workspace/tmp/sberid-login/kuper'
DEFAULT_KUPER_BOOTSTRAP_ENTRY_URL = 'https://kuper.ru/'
DEFAULT_SBER_COOKIES_PATH = '/root/.openclaw/workspace/sber-cookies.json'
REPO_OWNED_KUPER_BOOTSTRAP = 'repo:browser_platform/daemon/kuper_auth.py'


def _file_exists(path: str) -> bool:
    return Path(path).exists()


def _ensure_dir(directory: str) -> None:
    Path(directory).mkdir(parents=True, exist_ok=True)


async def _save_body_text(page, file_path: str) -> str:
    try:
        text = await page.locator('body').inner_text()
    except Exception:
        text = ''
    Path(file_path).write_text(text or '', 'utf-8')
    return text or ''


async def run_integrated_kuper_bootstrap(
    *,
    storage_state_path: str | None = None,
    cookies_path: str | None = None,
    out_dir: str | None = None,
    headed: bool = False,
    debug_screenshots: bool = False,
) -> dict:
    from ..playwright.browser_session import launch_camoufox_browser

    cookies_file = str(Path(cookies_path or DEFAULT_SBER_COOKIES_PATH).resolve())
    resolved_out_dir = str(Path(out_dir or DEFAULT_KUPER_BOOTSTRAP_OUT_DIR).resolve())

    if not _file_exists(cookies_file):
        return {
            'attempted': True, 'ok': False, 'status': 'skipped_missing_cookies',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': True,
            'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': storage_state_path,
            'outDir': resolved_out_dir, 'finalUrl': None, 'rawStatus': None,
            'errorMessage': 'Sber cookies file is missing',
        }

    state_path = str(Path(storage_state_path or DEFAULT_KUPER_STORAGE_STATE).resolve())
    screenshots: list = []
    _ensure_dir(resolved_out_dir)
    _ensure_dir(str(Path(state_path).parent))

    cookies = json.loads(Path(cookies_file).read_text('utf-8'))

    stop_camoufox = None
    browser = None
    page = None

    try:
        launched = await launch_camoufox_browser()
        browser = launched['browser']
        stop_camoufox = launched['stop']

        reused_saved_state = _file_exists(state_path)
        ctx_opts: dict = {'viewport': {'width': 1440, 'height': 1200}}
        if reused_saved_state:
            ctx_opts['storage_state'] = state_path
        context = await browser.new_context(**ctx_opts)
        page = await context.new_page()

        await context.add_cookies(cookies)
        await context.storage_state(path=state_path)

        await page.goto(DEFAULT_KUPER_BOOTSTRAP_ENTRY_URL, wait_until='domcontentloaded', timeout=120000)

        try:
            await page.wait_for_url(
                lambda url: not re.search(r'hcheck=|/xpvnsulc/', url, re.IGNORECASE),
                timeout=30000,
            )
        except Exception:
            pass

        await page.wait_for_timeout(2000)
        if debug_screenshots:
            shot = str(Path(resolved_out_dir) / '01-home.png')
            await page.screenshot(path=shot, full_page=True)
            screenshots.append(shot)

        after_goto_url = page.url
        if re.search(r'hcheck=|/xpvnsulc/', after_goto_url, re.IGNORECASE):
            await _save_body_text(page, str(Path(resolved_out_dir) / 'page.txt'))
            await context.storage_state(path=state_path)
            return {
                'attempted': True, 'ok': False, 'status': 'handoff_required',
                'handoffRequired': True, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
                'outDir': resolved_out_dir, 'finalUrl': after_goto_url,
                'rawStatus': 'anti_bot_challenge',
                'errorMessage': 'Anti-bot challenge detected on kuper.ru even with camoufox',
            }

        try:
            home_text = await page.locator('body').inner_text()
        except Exception:
            home_text = ''
        home_lowered = home_text.lower()
        already_auth = bool(re.search(r'профил|выйти|личный кабинет', home_lowered, re.IGNORECASE))

        if already_auth:
            await context.storage_state(path=state_path)
            return {
                'attempted': True, 'ok': True, 'status': 'state_refreshed',
                'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
                'outDir': resolved_out_dir, 'finalUrl': after_goto_url,
                'rawStatus': 'already-authenticated', 'errorMessage': None,
            }

        login_btn = page.locator('text=Войти').first
        try:
            await login_btn.wait_for(state='visible', timeout=25000)
        except Exception:
            url_after_wait = page.url
            if re.search(r'hcheck=|/xpvnsulc/', url_after_wait, re.IGNORECASE):
                await _save_body_text(page, str(Path(resolved_out_dir) / 'page.txt'))
                await context.storage_state(path=state_path)
                return {
                    'attempted': True, 'ok': False, 'status': 'handoff_required',
                    'handoffRequired': True, 'redirectedToSberId': False, 'bootstrapFailed': False,
                    'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
                    'outDir': resolved_out_dir, 'finalUrl': url_after_wait,
                    'rawStatus': 'anti_bot_challenge',
                    'errorMessage': 'Anti-bot JS challenge blocked kuper.ru access — IP likely flagged as datacenter',
                }
            raise Exception('Login button not found')

        before_click_url = page.url
        await asyncio.gather(
            page.wait_for_url(
                lambda u: bool(re.search(r'id\.sber\.ru|kuper\.ru', u, re.IGNORECASE)),
                timeout=20000,
            ),
            login_btn.click(timeout=10000),
            return_exceptions=True,
        )

        try:
            await page.wait_for_load_state('domcontentloaded', timeout=30000)
        except Exception:
            pass
        await page.wait_for_timeout(3000)

        final_url = page.url
        text = await _save_body_text(page, str(Path(resolved_out_dir) / 'page.txt'))
        if debug_screenshots:
            shot = str(Path(resolved_out_dir) / '02-after-login-click.png')
            await page.screenshot(path=shot, full_page=True)
            screenshots.append(shot)
        await context.storage_state(path=state_path)

        lowered = text.lower()
        redirected_to_sberid = bool(re.search(r'id\.sber\.ru', final_url, re.IGNORECASE))
        maybe_authenticated = (
            bool(re.search(r'профил|выйти|личный кабинет|мой профиль', lowered, re.IGNORECASE)) or
            (not redirected_to_sberid and final_url != before_click_url)
        )
        state_exists = _file_exists(state_path)

        if redirected_to_sberid:
            return {
                'attempted': True, 'ok': True, 'status': 'redirected_to_sberid',
                'handoffRequired': True, 'redirectedToSberId': True, 'bootstrapFailed': False,
                'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
                'outDir': resolved_out_dir, 'finalUrl': final_url,
                'rawStatus': 'redirected-to-sberid', 'errorMessage': None,
            }

        if maybe_authenticated:
            return {
                'attempted': True, 'ok': True,
                'status': 'state_refreshed' if state_exists else 'completed_without_auth',
                'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': False,
                'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
                'outDir': resolved_out_dir, 'finalUrl': final_url,
                'rawStatus': 'maybe-authenticated', 'errorMessage': None,
            }

        return {
            'attempted': True, 'ok': state_exists,
            'status': 'state_refreshed' if state_exists else 'completed_without_auth',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': not state_exists,
            'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': state_path,
            'outDir': resolved_out_dir, 'finalUrl': final_url,
            'rawStatus': 'loaded' if final_url == before_click_url else 'navigated',
            'errorMessage': None if state_exists else 'Bootstrap finished without producing a reusable state file',
        }

    except Exception as exc:
        if page:
            error_shot = str(Path(resolved_out_dir) / 'error.png')
            try:
                await page.screenshot(path=error_shot, full_page=True)
                screenshots.append(error_shot)
            except Exception:
                pass
        return {
            'attempted': True, 'ok': False, 'status': 'failed',
            'handoffRequired': False, 'redirectedToSberId': False, 'bootstrapFailed': True,
            'scriptPath': REPO_OWNED_KUPER_BOOTSTRAP, 'statePath': storage_state_path,
            'outDir': resolved_out_dir, 'finalUrl': page.url if page else None,
            'rawStatus': None, 'errorMessage': str(exc),
        }
    finally:
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
