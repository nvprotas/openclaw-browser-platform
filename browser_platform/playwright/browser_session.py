from __future__ import annotations
import asyncio
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, Playwright

from ..core.errors import BrowserPlatformError
from ..helpers.payment_context import extract_payment_context
from .snapshots import capture_page_snapshot
from .waits import wait_for_initial_load

_CAMOUFOX_WS_REGEX = re.compile(r'wss?://[^\s"\'<>]+', re.IGNORECASE)
_CAMOUFOX_STOP_TIMEOUT_S = 3.0

CAMOUFOX_SERVER_WRAPPER = r"""
import atexit
import base64
import signal
import subprocess
import sys
from pathlib import Path

import camoufox.server as server

config = server.launch_options(headless=True)
if config.get("proxy") is None:
    config.pop("proxy", None)

data = server.orjson.dumps(server.to_camel_case_dict(config))
nodejs = server.get_nodejs()

process = subprocess.Popen(
    [nodejs, str(server.LAUNCH_SCRIPT)],
    cwd=Path(nodejs).parent / "package",
    stdin=subprocess.PIPE,
    text=True,
)

def terminate_child() -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()

def handle_signal(_signum, _frame) -> None:
    terminate_child()
    sys.exit(0)

atexit.register(terminate_child)
signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

if process.stdin:
    process.stdin.write(base64.b64encode(data).decode())
    process.stdin.close()

process.wait()
raise RuntimeError("Server process terminated unexpectedly")
""".strip()

# Module-level playwright instance (initialized lazily by the daemon)
_playwright: Playwright | None = None


async def get_playwright() -> Playwright:
    global _playwright
    if _playwright is None:
        from playwright.async_api import async_playwright
        _playwright = await async_playwright().start()
    return _playwright


def extract_websocket_endpoint(log_line: str) -> str | None:
    normalized = log_line.strip()
    if not normalized:
        return None
    matched = _CAMOUFOX_WS_REGEX.search(normalized)
    if not matched:
        return None
    candidate = re.sub(r'[\]})},;]+$', '', matched.group(0))
    return candidate if (candidate.startswith('ws://') or candidate.startswith('wss://')) else None


def resolve_camoufox_python_command() -> str:
    explicit = os.environ.get('CAMOUFOX_PYTHON_BIN', '').strip()
    if explicit:
        return explicit

    openclaw_home = os.environ.get('OPENCLAW_HOME', '').strip() or str(Path.home() / '.openclaw')
    default_venv_python = str(Path(openclaw_home) / 'venvs' / 'camoufox' / 'bin' / 'python')
    if Path(default_venv_python).exists():
        return default_venv_python

    explicit_venv_dir = os.environ.get('CAMOUFOX_VENV_DIR', '').strip()
    if explicit_venv_dir:
        explicit_venv_python = str(Path(explicit_venv_dir) / 'bin' / 'python')
        if Path(explicit_venv_python).exists():
            return explicit_venv_python

    path_dirs = os.environ.get('PATH', '').split(':')
    if any(Path(d, 'python').exists() for d in path_dirs if d):
        return 'python'
    if any(Path(d, 'python3').exists() for d in path_dirs if d):
        return 'python3'
    return 'python'


async def _wait_for_camoufox_ws_endpoint(proc: subprocess.Popen, timeout_ms: int) -> str:
    loop = asyncio.get_event_loop()
    recent_logs: list[str] = []
    ws_endpoint: str | None = None
    line_buffer = ''

    async def read_stream(stream):
        nonlocal line_buffer, ws_endpoint
        while True:
            try:
                chunk = await loop.run_in_executor(None, stream.read, 256)
                if not chunk:
                    break
                line_buffer += chunk.decode('utf-8', errors='replace')
                parts = re.split(r'\r?\n', line_buffer)
                line_buffer = parts[-1]
                for raw_line in parts[:-1]:
                    line = raw_line.strip()
                    if not line:
                        continue
                    recent_logs.append(line)
                    if ws_endpoint is None:
                        endpoint = extract_websocket_endpoint(line)
                        if endpoint:
                            ws_endpoint = endpoint
                            return
            except Exception:
                break

    read_tasks = []
    if proc.stdout:
        read_tasks.append(asyncio.ensure_future(read_stream(proc.stdout)))
    if proc.stderr:
        read_tasks.append(asyncio.ensure_future(read_stream(proc.stderr)))

    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
    while ws_endpoint is None:
        if asyncio.get_event_loop().time() > deadline:
            for t in read_tasks:
                t.cancel()
            raise BrowserPlatformError(
                f'Timed out waiting for Camoufox ws endpoint after {timeout_ms}ms',
                code='SESSION_OPEN_FAILED',
                details={'recentLogs': recent_logs[-30:]},
            )
        if proc.poll() is not None:
            for t in read_tasks:
                t.cancel()
            raise BrowserPlatformError(
                f'Camoufox server exited before publishing ws endpoint',
                code='SESSION_OPEN_FAILED',
                details={'recentLogs': recent_logs[-30:]},
            )
        await asyncio.sleep(0.05)

    for t in read_tasks:
        t.cancel()
    return ws_endpoint


async def stop_camoufox_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, proc.wait),
            timeout=_CAMOUFOX_STOP_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        proc.kill()
        proc.wait()


async def launch_camoufox_browser(timeout_ms: int = 60_000) -> dict[str, Any]:
    python_bin = resolve_camoufox_python_command()
    proc = subprocess.Popen(
        [python_bin, '-c', CAMOUFOX_SERVER_WRAPPER],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    ws_endpoint = await _wait_for_camoufox_ws_endpoint(proc, timeout_ms)

    try:
        pw = await get_playwright()
        browser = await pw.firefox.connect(ws_endpoint, timeout=timeout_ms)

        async def stop():
            await stop_camoufox_process(proc)

        return {'browser': browser, 'stop': stop}
    except Exception as error:
        await stop_camoufox_process(proc)
        raise BrowserPlatformError(
            'Camoufox started but Playwright Firefox failed to connect',
            code='SESSION_OPEN_FAILED',
            details={'wsEndpoint': ws_endpoint, 'cause': str(error)},
        )


async def launch_chromium_browser(launch_options: dict | None = None) -> dict[str, Any]:
    pw = await get_playwright()
    browser = await pw.chromium.launch(headless=True, **(launch_options or {}))

    async def stop():
        pass

    return {'browser': browser, 'stop': stop}


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class BrowserContextPool:
    def __init__(self):
        self._entries: dict[str, dict[str, Any]] = {}

    async def acquire(
        self,
        backend: str = 'camoufox',
        storage_state_path: str = '',
        viewport: dict | None = None,
        camoufox_startup_timeout_ms: int | None = None,
        launch_options: dict | None = None,
    ) -> dict[str, Any]:
        key = f'{backend}:{storage_state_path}'
        existing = self._entries.get(key)
        if existing:
            existing['refCount'] += 1
            return {
                'browser': existing['browser'],
                'context': existing['context'],
                'reused': True,
                'release': lambda: self._release(key),
            }

        launched = (
            await launch_chromium_browser(launch_options)
            if backend == 'chromium'
            else await launch_camoufox_browser(camoufox_startup_timeout_ms or 60_000)
        )
        try:
            context = await launched['browser'].new_context(
                viewport=viewport or {'width': 1440, 'height': 900},
                storage_state=storage_state_path or None,
            )
            entry = {
                'key': key,
                'browser': launched['browser'],
                'context': context,
                'stop': launched['stop'],
                'refCount': 1,
            }
            self._entries[key] = entry
            return {
                'browser': entry['browser'],
                'context': entry['context'],
                'reused': False,
                'release': lambda: self._release(key),
            }
        except Exception:
            await launched['browser'].close()
            await launched['stop']()
            raise

    async def _release(self, key: str) -> None:
        entry = self._entries.get(key)
        if not entry:
            return
        entry['refCount'] = max(0, entry['refCount'] - 1)
        if entry['refCount'] > 0:
            return
        del self._entries[key]
        try:
            await entry['context'].close()
        except Exception:
            pass
        results = await asyncio.gather(
            entry['browser'].close(), entry['stop'](),
            return_exceptions=True,
        )

    async def close_all(self) -> None:
        entries = list(self._entries.values())
        self._entries.clear()
        for entry in entries:
            try:
                await entry['context'].close()
            except Exception:
                pass
            await asyncio.gather(
                entry['browser'].close(), entry['stop'](),
                return_exceptions=True,
            )


# The JavaScript observe evaluation script (preserved from TypeScript source)
_OBSERVE_JS = r"""
() => {
  const normalizeText = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const mainEl = document.body;
  const seenTexts = new Set();
  const visibleTexts = [];
  const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode && visibleTexts.length < 90) {
    const raw = normalizeText(textNode.textContent);
    if (raw.length >= 3) {
      const parent = textNode.parentElement;
      if (parent) {
        const style = window.getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0) {
          if (!seenTexts.has(raw)) {
            seenTexts.add(raw);
            visibleTexts.push(raw);
          }
        }
      }
    }
    textNode = walker.nextNode();
  }
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const paymentHintPattern = /payecom\.ru|platiecom\.ru|id\.sber\.ru|sberid|sberpay|сбер|сбп|orderid=|bankinvoiceid=|mdorder=|merchantorderid=|merchantordernumber=|formurl=|purchase\/ppd/i;
  const paymentUrlPattern = /https?:\/\/(?:www\.)?(?:payecom\.ru\/pay(?:_ru)?|platiecom\.ru\/deeplink|id\.sber\.ru\/[^\s"'<>)]*)[^\s"'<>)]*|(?:orderid|bankinvoiceid|mdorder|merchantorderid|merchantordernumber|formurl)[^\s"'<>]*/gi;
  const paymentAttributeNames = ['href','src','action','formaction','onclick','data-href','data-url','data-link','data-target-url','data-action','data-testid','data-payment-method','data-payment-system','aria-label'];
  const collectElementPaymentHints = (element) => {
    const hints = [];
    for (const name of paymentAttributeNames) {
      const value = element.getAttribute(name);
      if (value && paymentHintPattern.test(value)) hints.push(value);
    }
    const formAction = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
      ? element.formAction || element.form?.getAttribute('action') || null : null;
    if (formAction && paymentHintPattern.test(formAction)) hints.push(formAction);
    return hints;
  };
  const toButtonSummary = (element) => {
    const inputType = element instanceof HTMLInputElement ? element.type : null;
    const text = normalizeText(element instanceof HTMLInputElement ? element.value : element.innerText || element.textContent);
    const ariaLabel = normalizeText(element.getAttribute('aria-label')) || null;
    const dataAttributes = Array.from(element.attributes).reduce((acc, attr) => {
      if (attr.name.startsWith('data-') && attr.value && paymentHintPattern.test(attr.value)) acc[attr.name] = attr.value;
      return acc;
    }, {});
    const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href') ?? element.getAttribute('data-href') ?? element.getAttribute('data-url');
    const formAction = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
      ? element.getAttribute('formaction') ?? element.form?.getAttribute('action') ?? null : element.getAttribute('formaction');
    const paymentHints = collectElementPaymentHints(element);
    const selector = (() => {
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      const id = element.id;
      if (id) return `#${id}`;
      const tag = element.tagName.toLowerCase();
      const label = element.getAttribute('aria-label');
      if (label) return `${tag}[aria-label="${label}"]`;
      const name = element.getAttribute('name');
      if (name) return `${tag}[name="${name}"]`;
      return null;
    })();
    return { text, role: element.getAttribute('role') ?? element.tagName.toLowerCase(), type: inputType, ariaLabel, selector, href: href || null, formAction: formAction || null, dataAttributes, paymentHints };
  };
  const prioritySelectors = ["button:not([disabled])[class*='buy']","button:not([disabled])[class*='cart']","button:not([disabled])[class*='purchase']","[role='button'][class*='buy']","[role='button'][class*='cart']","[data-testid*='buy']","[data-testid*='cart']","[data-testid*='purchase']"];
  const priorityButtons = prioritySelectors.flatMap(sel => Array.from(document.querySelectorAll(sel))).filter(isVisible).map(toButtonSummary).filter(b => b.text.length > 0 || b.ariaLabel);
  const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')).filter(isVisible).map(toButtonSummary).filter(b => b.text.length > 0 || b.ariaLabel);
  const seen = new Set();
  const visibleButtons = [...priorityButtons, ...allButtons].filter(b => {
    const key = `${b.text}|${b.ariaLabel ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
  const forms = Array.from(document.forms).map(form => {
    const submitLabels = Array.from(form.querySelectorAll('button, input[type="submit"]')).map(el => normalizeText(el instanceof HTMLInputElement ? el.value : el.innerText || el.textContent)).filter(t => t.length > 0).slice(0, 12);
    return { id: form.id || null, name: form.getAttribute('name'), method: form.getAttribute('method'), action: form.getAttribute('action'), inputCount: form.querySelectorAll('input, textarea, select').length, submitLabels };
  });
  const urlHintSources = [
    ...Array.from(document.querySelectorAll('a[href], iframe[src], frame[src], form[action], [data-href], [data-url], [data-link], [data-target-url]')).map(el => el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? el.getAttribute('data-href') ?? el.getAttribute('data-url') ?? el.getAttribute('data-link') ?? el.getAttribute('data-target-url')),
    ...Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')).flatMap(el => {
      const hints = collectElementPaymentHints(el);
      if (!paymentHintPattern.test(normalizeText(el.innerText || el.textContent)) && hints.length === 0) return [];
      return [...hints, ...Array.from(el.closest('form')?.attributes ?? []).map(attr => attr.value).filter(v => paymentHintPattern.test(v))];
    }),
    ...Array.from(document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script')).map(s => normalizeText(s.textContent).slice(0, 20000)).filter(v => paymentHintPattern.test(v)).filter(v => v.length > 0)
  ];
  const urlHints = urlHintSources.flatMap(raw => {
    if (!raw) return [];
    const normalized = normalizeText(raw);
    const matches = normalized.match(paymentUrlPattern);
    if (matches?.length) return matches.slice(0, 18);
    return paymentHintPattern.test(normalized) && normalized.length <= 2000 ? [normalized] : [];
  }).filter(Boolean).filter(v => /payecom\.ru|platiecom\.ru|id\.sber\.ru|sberid|orderid=|bankinvoiceid=|mdorder=|merchantorderid=|merchantordernumber=|formurl=|purchase\/ppd/i.test(v)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 72);
  const lowerTexts = visibleTexts.join(' ').toLowerCase();
  const buttonTexts = visibleButtons.map(b => `${b.text} ${b.ariaLabel ?? ''}`.trim().toLowerCase()).join(' ');
  const hasSearchSignals = /search|найти|поиск|каталог|catalog|корзин|my books|мои книги/.test(lowerTexts);
  const hasAuthWords = /sign in|log in|войти|password|пароль/.test(lowerTexts);
  const hasSearchForm = forms.some(f => (f.action ?? '').toLowerCase().includes('/search'));
  const hasLikelyAuthForm = forms.some(f => f.inputCount >= 2 && !((f.action ?? '').toLowerCase().includes('/search')));
  const currentUrl = window.location.href;
  const urlHasSearch = /[?&]q=|\/search/i.test(currentUrl);
  const urlHasCart = /\/cart|\/basket|\/my-books\/cart/i.test(currentUrl);
  const urlHasCheckout = /\/purchase\/ppd\b/i.test(currentUrl);
  const urlHasProduct = /\/book\/|\/audiobook\/|\/product\//i.test(currentUrl);
  const hasBuyButtons = /buy|add to cart|purchase|купить|в корзину/.test(buttonTexts);
  const hasCartConfirmation = /added to cart|go to cart|перейти в корзину|товар добавлен|добавлено в корзину/i.test(lowerTexts + ' ' + buttonTexts);
  let pageSignatureGuess = 'unknown';
  if (urlHasCheckout) pageSignatureGuess = 'checkout_payment_choice';
  else if (hasLikelyAuthForm || (hasAuthWords && !hasSearchSignals)) pageSignatureGuess = 'auth_form';
  else if (urlHasCart || hasCartConfirmation) pageSignatureGuess = 'cart';
  else if (urlHasProduct || hasBuyButtons) pageSignatureGuess = 'product_page';
  else if (!hasBuyButtons && /cart|basket|checkout|корзин/.test(lowerTexts) && !urlHasSearch) pageSignatureGuess = 'cart';
  else if (urlHasSearch || /search|results|найден|результат/.test(lowerTexts)) pageSignatureGuess = 'search_results';
  else if (hasSearchSignals || hasSearchForm) pageSignatureGuess = 'home';
  else if (visibleTexts.length > 0) pageSignatureGuess = 'content_page';
  return { visibleTexts, visibleButtons, forms, urlHints, pageSignatureGuess };
}
"""


class BrowserSession:
    def __init__(self, options: dict[str, Any]):
        self._options = options
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._stop_browser = None
        self._context_lease: dict | None = None
        self._last_used_at = 0.0
        self._close_lock = asyncio.Lock()
        self._closed = False

    def adopt_existing(self, session: dict) -> None:
        self._browser = session['browser']
        self._context = session['context']
        self._page = session['page']
        self._stop_browser = session['stop']
        self._context_lease = None
        self.mark_used()

    def mark_used(self) -> None:
        import time
        self._last_used_at = time.time()

    def get_last_used_at(self) -> float:
        return self._last_used_at

    async def open(self, url: str) -> dict:
        backend = self._options.get('backend', 'camoufox')
        open_started_at = _iso_now()
        import time
        open_started_ms = time.time()
        stages = []

        browser = None
        context = None
        page = None

        async def run_stage(step: str, fn, detail=None):
            started_at = _iso_now()
            import time as t
            started_ms = t.time()
            try:
                result = await fn()
                stages.append({'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(), 'durationMs': int((t.time() - started_ms) * 1000), 'status': 'ok', 'detail': detail})
                return result
            except Exception as err:
                stages.append({'step': step, 'startedAt': started_at, 'finishedAt': _iso_now(), 'durationMs': int((t.time() - started_ms) * 1000), 'status': 'error', 'detail': str(err)})
                raise

        try:
            pool = self._options.get('contextPool')
            storage_state_path = self._options.get('storageStatePath')

            if pool and storage_state_path:
                lease = await run_stage(
                    'acquire_shared_context',
                    lambda: pool.acquire(backend=backend, storage_state_path=storage_state_path, viewport={'width': 1440, 'height': 900}),
                    storage_state_path,
                )
                self._context_lease = lease
                browser = lease['browser']
                context = lease['context']
                stages.append({'step': 'reuse_shared_context' if lease['reused'] else 'create_shared_context', 'startedAt': _iso_now(), 'finishedAt': _iso_now(), 'durationMs': 0, 'status': 'ok', 'detail': storage_state_path})
            else:
                launched = await run_stage(
                    f'launch_{backend}_browser',
                    lambda: launch_chromium_browser() if backend == 'chromium' else launch_camoufox_browser(),
                )
                self._stop_browser = launched['stop']
                browser = launched['browser']
                _browser = browser

                async def make_context():
                    kwargs: dict = {'viewport': {'width': 1440, 'height': 900}}
                    if storage_state_path:
                        kwargs['storage_state'] = storage_state_path
                    return await _browser.new_context(**kwargs)

                context = await run_stage('new_context', make_context, storage_state_path)

            _context = context
            page = await run_stage('new_page', lambda: _context.new_page())
            _page = page
            await run_stage('goto_domcontentloaded', lambda: _page.goto(url, wait_until='domcontentloaded'), url)
            await run_stage('wait_for_initial_load', lambda: wait_for_initial_load(_page))

        except Exception as error:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            if self._context_lease:
                try:
                    await self._context_lease['release']()
                except Exception:
                    pass
                self._context_lease = None
            else:
                if context:
                    try:
                        await context.close()
                    except Exception:
                        pass
                if browser:
                    try:
                        await browser.close()
                    except Exception:
                        pass
                if self._stop_browser:
                    try:
                        await self._stop_browser()
                    except Exception:
                        pass
                self._stop_browser = None
            raise BrowserPlatformError(
                f'Failed to open browser session ({backend})',
                code='SESSION_OPEN_FAILED',
                details={'backend': backend, 'url': url, 'cause': str(error)},
            )

        self._browser = browser
        self._context = context
        self._page = page
        self.mark_used()

        await run_stage('persist_storage_state', self.persist_storage_state, storage_state_path)

        import time
        title = await run_stage('read_page_title', page.title)
        return {
            'url': page.url,
            'title': title,
            'timing': {
                'startedAt': open_started_at,
                'finishedAt': _iso_now(),
                'durationMs': int((time.time() - open_started_ms) * 1000),
                'stages': stages,
            },
        }

    def page(self) -> Page:
        return self._require_page()

    async def wait_for_initial_load(self) -> None:
        await wait_for_initial_load(self._require_page())

    async def persist_storage_state(self) -> None:
        if not self._context or not self._options.get('storageStatePath'):
            return
        await self._context.storage_state(path=self._options['storageStatePath'])

    async def observe(self) -> dict:
        self.mark_used()
        page = self._require_page()
        summary = await page.evaluate(_OBSERVE_JS)
        await self.persist_storage_state()

        viewport = page.viewport_size or {'width': 0, 'height': 0}
        state = {
            'url': page.url,
            'title': await page.title(),
            'readyState': await page.evaluate('() => document.readyState'),
            'viewport': viewport,
            **summary,
        }
        return {**state, 'paymentContext': extract_payment_context(state)}

    async def snapshot(self) -> dict:
        self.mark_used()
        page = self._require_page()
        try:
            await page.wait_for_load_state('networkidle', timeout=5000)
        except Exception:
            pass
        paths = await capture_page_snapshot(page, self._options.get('snapshotRootDir', '.'), self._options.get('sessionId', 'session'))
        await self.persist_storage_state()
        return {**paths, 'state': await self.observe()}

    async def close(self) -> None:
        async with self._close_lock:
            if self._closed:
                return
            self._closed = True
            if self._page:
                try:
                    await self._page.close()
                except Exception:
                    pass
            if not self._context_lease:
                if self._context:
                    try:
                        await self._context.close()
                    except Exception:
                        pass
                if self._browser:
                    try:
                        await self._browser.close()
                    except Exception:
                        pass
                if self._stop_browser:
                    try:
                        await self._stop_browser()
                    except Exception:
                        pass
            else:
                try:
                    await self._context_lease['release']()
                except Exception:
                    pass
            self._page = None
            self._context = None
            self._browser = None
            self._context_lease = None
            self._stop_browser = None

    def _require_page(self) -> Page:
        if not self._page:
            raise BrowserPlatformError('Session page is not initialized', code='SESSION_NOT_READY')
        return self._page
