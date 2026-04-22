from __future__ import annotations
import asyncio
import re

from ..core.errors import BrowserPlatformError
from ..helpers.retries import with_retry
from ..helpers.validation import build_post_action_observations
from ..helpers.tracing import build_action_diff
from ..helpers.payment_context import extract_payment_context

PAYMENT_GATEWAY_URL_PATTERN = re.compile(
    r'^https://(?:www\.)?payecom\.ru/pay(?:_ru)?\?', re.IGNORECASE
)
MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS = 2

_DESCRIBE_BLOCKER_JS = """
({ xPos, yPos }) => {
    const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
    const element = document.elementFromPoint(xPos, yPos);
    if (!element) return null;
    const parts = [];
    let current = element;
    while (current && parts.length < 4) {
        const testId = current.getAttribute('data-testid');
        const id = current.id ? '#' + current.id : '';
        const role = current.getAttribute('role');
        const aria = current.getAttribute('aria-label');
        const text = normalize(current.textContent).slice(0, 80);
        parts.push([
            current.tagName.toLowerCase(),
            id,
            testId ? '[data-testid="' + testId + '"]' : '',
            role ? '[role="' + role + '"]' : '',
            aria ? '[aria-label="' + aria + '"]' : '',
            text ? 'text="' + text + '"' : ''
        ].filter(Boolean).join(''));
        current = current.parentElement;
    }
    return parts.join(' <- ');
}
"""

_DISMISS_MODALS_JS = """
(blockerDescription) => {
    const normalize = (value) => (value ?? '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || '1') > 0.01 &&
            rect.width > 0 && rect.height > 0;
    };
    const textOf = (element) => normalize(element?.textContent).slice(0, 300);
    const click = (element, selector) => {
        const text = normalize(element.innerText || element.textContent).slice(0, 80) ||
            normalize(element.getAttribute('aria-label'));
        element.click();
        return { status: 'dismissed', reason: 'dismissed by safe modal control',
            selector, text: text || null, blocker: blockerDescription };
    };

    const rootSelectors = [
        '[data-testid="modal--overlay"]',
        '[data-testid="modal--wrapper"]',
        '#litres-modal-container',
        '[role="dialog"]',
        '[aria-modal="true"]'
    ];
    const safeClickSelectors = [
        '[data-testid="modal--overlay"] header > div:nth-child(2)',
        '[data-testid="modal--wrapper"] header > div:nth-child(2)',
        '[data-testid="modal--close-button"]',
        '[data-testid="icon_close"]',
        'button[aria-label*="Закрыть"]',
        'button[aria-label*="Close"]',
        '[role="button"][aria-label*="Закрыть"]',
        '[role="button"][aria-label*="Close"]'
    ];
    const safeButtonPattern = /^(?:принять|закрыть|не сейчас|позже|понятно|ok|okay|accept|close)$/i;
    const authPattern = /войти|авторизац|номер телефона|пароль|продолжить|другие способы|sber id|сбер id/i;
    const authSelectors = [
        '[data-testid^="auth__"]',
        'input[type="password"]',
        'input[type="tel"]',
        'input[name*="phone" i]',
        'input[name*="password" i]'
    ];

    const roots = rootSelectors
        .flatMap(selector =>
            Array.from(document.querySelectorAll(selector))
                .filter(isVisible)
                .map(element => ({ element, selector }))
        )
        .filter((entry, index, all) =>
            all.findIndex(other => other.element === entry.element) === index
        );
    const root = roots[0] ?? null;

    if (root) {
        const rootText = textOf(root.element);
        const hasAuthControl = authSelectors.some(selector => root.element.querySelector(selector));
        if (hasAuthControl && authPattern.test(rootText)) {
            return { status: 'not_dismissible',
                reason: 'Blocking modal looks like an authentication gate.',
                selector: root.selector, text: rootText || null, blocker: blockerDescription };
        }
        for (const selector of safeClickSelectors) {
            const candidate = root.element.querySelector(selector) ?? document.querySelector(selector);
            if (isVisible(candidate)) return click(candidate, selector);
        }
        const buttons = Array.from(root.element.querySelectorAll('button, [role="button"], a'));
        const safeButton = buttons.find(button =>
            isVisible(button) &&
            safeButtonPattern.test(normalize(button.innerText || button.textContent || button.getAttribute('aria-label')))
        );
        if (safeButton) return click(safeButton, null);
        return { status: 'not_dismissible', reason: 'Blocking modal has no safe dismiss control.',
            selector: root.selector, text: rootText || null, blocker: blockerDescription };
    }

    const globalSafeButton = blockerDescription
        ? Array.from(document.querySelectorAll('button, [role="button"]')).find(button => {
            if (!isVisible(button)) return false;
            const text = normalize(button.innerText || button.textContent || button.getAttribute('aria-label'));
            if (!safeButtonPattern.test(text)) return false;
            const rect = button.getBoundingClientRect();
            return rect.width >= 20 && rect.height >= 20;
          })
        : null;
    if (globalSafeButton) return click(globalSafeButton, null);

    return { status: 'none', reason: 'No visible blocking modal found.',
        selector: null, text: null, blocker: blockerDescription };
}
"""


def _normalize(value: str | None) -> str:
    return re.sub(r'\s+', ' ', (value or '')).strip()


async def _resolve_locator(session, action: dict):
    page = session.page()
    if action.get('selector'):
        return page.locator(action['selector']).first
    if action.get('role'):
        opts = {'name': action['name']} if action.get('name') else {}
        return page.get_by_role(action['role'], **opts).first
    if action.get('text'):
        return page.get_by_text(action['text'], exact=action.get('exact', False)).first
    raise BrowserPlatformError(
        'Action target requires selector, role, or text',
        code='ACTION_TARGET_REQUIRED',
    )


async def _wait_for_navigation_settled(session) -> None:
    page = session.page()
    url_before = page.url
    try:
        await page.wait_for_url(lambda url: url != url_before, timeout=1500)
        try:
            await page.wait_for_load_state('domcontentloaded', timeout=3000)
        except Exception:
            pass
    except Exception:
        pass


async def _describe_point_blocker(locator) -> str | None:
    try:
        box = await locator.bounding_box()
    except Exception:
        return None
    if not box:
        return None
    x = box['x'] + box['width'] / 2
    y = box['y'] + box['height'] / 2
    try:
        return await locator.page.evaluate(_DESCRIBE_BLOCKER_JS, {'xPos': x, 'yPos': y})
    except Exception:
        return None


def _build_modal_observation(result: dict) -> dict | None:
    if result['status'] == 'dismissed':
        text_part = f' using "{result["text"]}"' if result.get('text') else ''
        return {
            'level': 'info',
            'code': 'BLOCKING_MODAL_DISMISSED',
            'message': f'Dismissed blocking modal{text_part}.',
        }
    if result['status'] == 'not_dismissible':
        return {
            'level': 'warning',
            'code': 'MODAL_NOT_DISMISSIBLE',
            'message': result['reason'],
        }
    return None


def _unique_observations(observations: list) -> list:
    seen: set[str] = set()
    result = []
    for obs in observations:
        if obs is None:
            continue
        key = f"{obs['code']}|{obs['message']}"
        if key in seen:
            continue
        seen.add(key)
        result.append(obs)
    return result


async def dismiss_blocking_modals(session, blocker: str | None = None) -> dict:
    result = await session.page().evaluate(_DISMISS_MODALS_JS, blocker)
    if result['status'] == 'dismissed':
        await asyncio.gather(
            _wait_with_timeout(session.page().wait_for_load_state('domcontentloaded', timeout=1000), 1.0),
            asyncio.sleep(0.25),
        )
        await asyncio.sleep(0.25)
    return result


async def _wait_with_timeout(coro, timeout: float) -> None:
    try:
        await asyncio.wait_for(asyncio.shield(asyncio.ensure_future(coro)), timeout=timeout)
    except Exception:
        pass


def _payment_fingerprint(ctx: dict) -> str:
    import json
    return json.dumps({k: ctx.get(k) for k in (
        'detected', 'provider', 'phase', 'paymentMethod', 'paymentSystem',
        'paymentUrl', 'paymentOrderId', 'litresOrder', 'traceId',
        'bankInvoiceId', 'merchantOrderNumber', 'merchantOrderId',
        'mdOrder', 'formUrl', 'rawDeeplink', 'href', 'extractionJson',
    )})


def _is_payment_flow_url(url: str) -> bool:
    return bool(re.search(
        r'/purchase/ppd\b|payecom\.ru/pay(?:_ru)?|platiecom\.ru/deeplink',
        url, re.IGNORECASE,
    ))


def with_payment_hint(state: dict, hint: str | None) -> dict:
    if not hint or hint in state.get('urlHints', []):
        return state
    next_state = {**state, 'urlHints': [*state.get('urlHints', []), hint]}
    return {**next_state, 'paymentContext': extract_payment_context(next_state)}


def should_capture_payment_gateway_url(payload: dict, before: dict) -> bool:
    if payload.get('action') != 'click':
        return False
    before_url = before.get('url', '')
    payment_ctx = before.get('paymentContext', {})
    if not re.search(r'/purchase/ppd\b', before_url, re.IGNORECASE) and \
            payment_ctx.get('phase') != 'litres_checkout':
        return False
    if payment_ctx.get('terminalExtractionResult') or payment_ctx.get('paymentOrderId'):
        return False
    selector = payload.get('selector', '') or ''
    target_name = _normalize(payload.get('name'))
    target_text = _normalize(payload.get('text'))
    target_blob = f'{selector} {target_name} {target_text}'.lower()
    return bool(re.search(
        r'paymentlayout__payment--button|продолжить|sber|сбер|сбп|российская карта',
        target_blob,
    ))


async def _capture_payment_gateway_url_during_click(session, click_action) -> str | None:
    page = session.page()
    captured_url: list[str | None] = [None]

    def remember_url(url: str) -> None:
        if not captured_url[0] and PAYMENT_GATEWAY_URL_PATTERN.match(url):
            captured_url[0] = url

    async def route_handler(route) -> None:
        request_url = route.request.url
        remember_url(request_url)
        if PAYMENT_GATEWAY_URL_PATTERN.match(request_url):
            await route.abort('aborted')
        else:
            await route.continue_()

    def request_handler(request) -> None:
        remember_url(request.url)

    def frame_handler(frame) -> None:
        remember_url(frame.url)

    await page.route(PAYMENT_GATEWAY_URL_PATTERN.pattern, route_handler)
    page.on('request', request_handler)
    page.on('framenavigated', frame_handler)
    try:
        await click_action()
        try:
            async def _wait_for_request():
                await page.wait_for_request(
                    lambda r: bool(PAYMENT_GATEWAY_URL_PATTERN.match(r.url)),
                    timeout=1000,
                )
                if captured_url[0] is None:
                    pass

            await asyncio.wait_for(asyncio.ensure_future(_wait_for_request()), timeout=1.0)
        except Exception:
            pass
    except Exception:
        if not captured_url[0]:
            raise
    finally:
        page.remove_listener('request', request_handler)
        page.remove_listener('framenavigated', frame_handler)
        try:
            await page.unroute(PAYMENT_GATEWAY_URL_PATTERN.pattern, route_handler)
        except Exception:
            pass
    return captured_url[0]


def _should_stabilize_for_payment_flow(payload: dict, before: dict, after: dict) -> bool:
    action = payload.get('action')
    if action not in ('click', 'navigate'):
        return False
    selector = payload.get('selector', '') or ''
    target_name = _normalize(payload.get('name'))
    target_text = _normalize(payload.get('text'))
    target_blob = f'{selector} {target_name} {target_text}'.lower()
    if re.search(
        r'paymentlayout__payment--button|sbid-button|перейти к покупке|продолжить|сбер id|sber id',
        target_blob,
    ):
        return True
    return (
        _is_payment_flow_url(before.get('url', '')) or
        _is_payment_flow_url(after.get('url', '')) or
        before.get('paymentContext', {}).get('detected') or
        after.get('paymentContext', {}).get('detected') or
        before.get('paymentContext', {}).get('phase') in ('litres_checkout', 'payecom_boundary') or
        after.get('paymentContext', {}).get('phase') in ('litres_checkout', 'payecom_boundary')
    )


async def _stabilize_after_payment_action(
    session,
    payload: dict,
    before: dict,
    initial_after: dict,
    payment_gateway_hint: str | None = None,
) -> dict:
    if not _should_stabilize_for_payment_flow(payload, before, initial_after):
        return initial_after

    best = initial_after
    initial_fingerprint = _payment_fingerprint(initial_after.get('paymentContext', {}))

    for _ in range(8):
        await asyncio.sleep(0.3)
        current = with_payment_hint(await session.observe(), payment_gateway_hint)

        payment_changed = _payment_fingerprint(current.get('paymentContext', {})) != initial_fingerprint
        url_hints_changed = '\n'.join(current.get('urlHints', [])) != '\n'.join(best.get('urlHints', []))
        texts_changed = '\n'.join(current.get('visibleTexts', [])) != '\n'.join(best.get('visibleTexts', []))
        buttons_changed = (
            '\n'.join(f"{b.get('text')}|{b.get('ariaLabel') or ''}" for b in current.get('visibleButtons', []))
            != '\n'.join(f"{b.get('text')}|{b.get('ariaLabel') or ''}" for b in best.get('visibleButtons', []))
        )
        if (payment_changed or url_hints_changed or texts_changed or buttons_changed or
                current.get('url') != best.get('url') or current.get('title') != best.get('title')):
            best = current

        payment_ctx = current.get('paymentContext', {})
        if (
            payment_ctx.get('shouldReportImmediately') or
            payment_ctx.get('phase') == 'payecom_boundary' or
            any(re.search(r'войти по сбер id|номер карты|cvc|cvv|месяц\/год|оплатить', t, re.IGNORECASE)
                for t in current.get('visibleTexts', [])) or
            any(re.search(r'payecom\.ru/pay(?:_ru)?|id\.sber\.ru', h, re.IGNORECASE)
                for h in current.get('urlHints', []))
        ):
            best = current
            break

    return best


async def run_step(session, payload: dict) -> tuple[dict, dict, list]:
    before = await session.observe()
    captured_payment_gateway_url: str | None = None
    modal_observations: list = []
    action = payload.get('action')

    if action == 'navigate':
        async def _navigate():
            await session.page().goto(
                payload['url'],
                wait_until='domcontentloaded',
                timeout=payload.get('timeoutMs', 15_000),
            )
            await session.wait_for_initial_load()

        await with_retry(_navigate)

    elif action == 'wait_for':
        timeout = payload.get('timeoutMs', 5_000)
        state = payload.get('state', 'visible')
        if payload.get('selector'):
            await session.page().wait_for_selector(payload['selector'], state=state, timeout=timeout)
        elif payload.get('text'):
            await session.page().get_by_text(
                payload['text'], exact=payload.get('exact', False)
            ).first.wait_for(state=state, timeout=timeout)
        elif payload.get('role'):
            opts = {'name': payload['name']} if payload.get('name') else {}
            await session.page().get_by_role(payload['role'], **opts).first.wait_for(
                state=state, timeout=timeout,
            )
        else:
            raise BrowserPlatformError(
                'wait_for requires selector, text, or role',
                code='ACTION_TARGET_REQUIRED',
            )

    else:
        locator = await _resolve_locator(session, payload)

        if action == 'click':
            async def click_action():
                for attempt in range(MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS + 1):
                    try:
                        await locator.click(timeout=payload.get('timeoutMs', 5_000))
                        await _wait_for_navigation_settled(session)
                        if attempt > 0:
                            modal_observations.append({
                                'level': 'info',
                                'code': 'CLICK_RETRIED_AFTER_MODAL_DISMISS',
                                'message': 'Click completed after dismissing a blocking modal.',
                            })
                        return
                    except Exception as err:
                        if attempt >= MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS:
                            raise
                        blocker = await _describe_point_blocker(locator)
                        dismiss_result = await dismiss_blocking_modals(session, blocker)
                        if dismiss_result['status'] != 'none':
                            modal_observations.append({
                                'level': 'warning',
                                'code': 'BLOCKING_MODAL_DETECTED',
                                'message': (
                                    f'Click target was blocked by {blocker}.'
                                    if blocker else 'Click target was blocked by a modal.'
                                ),
                            })
                            modal_observations.append(_build_modal_observation(dismiss_result))
                        if dismiss_result['status'] != 'dismissed':
                            raise

            if should_capture_payment_gateway_url(payload, before):
                captured_payment_gateway_url = await _capture_payment_gateway_url_during_click(
                    session, click_action
                )
            else:
                await click_action()

        elif action == 'fill':
            await locator.fill(payload['value'], timeout=payload.get('timeoutMs', 5_000))

        elif action == 'type':
            if payload.get('clearFirst'):
                await locator.fill('', timeout=payload.get('timeoutMs', 5_000))
            await locator.type(
                payload['value'],
                delay=payload.get('delayMs', 20),
                timeout=payload.get('timeoutMs', 5_000),
            )

        elif action == 'press':
            await locator.press(
                payload['key'],
                delay=payload.get('delayMs', 0),
                timeout=payload.get('timeoutMs', 5_000),
            )
            await _wait_for_navigation_settled(session)

    observed_after = with_payment_hint(await session.observe(), captured_payment_gateway_url)
    after = await _stabilize_after_payment_action(
        session, payload, before, observed_after, captured_payment_gateway_url
    )
    return before, after, _unique_observations(modal_observations)


def build_action_result(
    payload: dict,
    before: dict,
    after: dict,
    extra_observations: list | None = None,
) -> dict:
    return {
        'action': payload.get('action'),
        'target': {
            'selector': payload.get('selector'),
            'role': payload.get('role'),
            'name': _normalize(payload.get('name')) or None,
            'text': _normalize(payload.get('text')) or None,
        },
        'input': {
            'value': payload.get('value'),
            'url': payload.get('url'),
            'key': payload.get('key'),
        },
        'before': before,
        'after': after,
        'changes': build_action_diff(before, after),
        'observations': [
            *(extra_observations or []),
            *build_post_action_observations(before, after),
        ],
    }
