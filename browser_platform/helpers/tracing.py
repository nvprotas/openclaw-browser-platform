from __future__ import annotations
import re
from typing import Any


def _normalize(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for v in values:
        s = re.sub(r'\s+', ' ', v).strip()
        if s and s not in seen:
            seen.add(s)
            result.append(s)
    return result


def summarize_observation(state: dict) -> list[dict]:
    observations: list[dict] = []

    sig = state.get('pageSignatureGuess', '')
    if sig == 'cart':
        observations.append({'level': 'info', 'code': 'CART_VISIBLE', 'message': 'Cart-like signals are visible on the page.'})
    if sig == 'product_page':
        observations.append({'level': 'info', 'code': 'PRODUCT_CTA_VISIBLE', 'message': 'Product purchase/add-to-cart CTA signals are visible.'})
    if sig == 'search_results':
        observations.append({'level': 'info', 'code': 'SEARCH_RESULTS_VISIBLE', 'message': 'Search/results-like signals are visible.'})

    pc = state.get('paymentContext', {})
    if pc.get('phase') == 'payecom_boundary':
        observations.append({'level': 'info', 'code': 'PAYMENT_BOUNDARY_VISIBLE', 'message': 'Payecom payment boundary is visible.'})
    if pc.get('phase') == 'litres_checkout':
        observations.append({'level': 'info', 'code': 'CHECKOUT_VISIBLE', 'message': 'Checkout/payment-choice signals are visible.'})

    if any(re.search(r'войти по сбер id', t, re.IGNORECASE) for t in state.get('visibleTexts', [])):
        observations.append({'level': 'info', 'code': 'SBERPAY_ENTRY_VISIBLE', 'message': 'SberPay entry is visible (`Войти по Сбер ID`).'})

    href = pc.get('href', '')
    if href and re.search(r'id\.sber\.ru/.+authorize', href, re.IGNORECASE):
        observations.append({'level': 'info', 'code': 'SBER_ID_HANDOFF_VISIBLE', 'message': 'A Sber ID handoff URL is visible in the current payment flow.'})

    if pc.get('phase') == 'payecom_boundary':
        texts = state.get('visibleTexts', [])
        if any(re.search(r'номер карты|cvc|cvv|месяц/год|оплатить', t, re.IGNORECASE) for t in texts):
            observations.append({'level': 'info', 'code': 'PAYMENT_BOUNDARY_CARD_FORM_VISIBLE',
                                  'message': 'The payecom boundary is fully visible (card form / final pay controls present). Stop before pressing final `Оплатить` unless explicitly requested.'})
        if any(re.search(r'привязанн|выберите карту|карта', t, re.IGNORECASE) for t in texts):
            observations.append({'level': 'info', 'code': 'SBERPAY_METHOD_SELECTION_VISIBLE',
                                  'message': 'A deeper SberPay payment selection/cards state is visible after the Sber ID entry point. Treat this as a safe stop boundary unless the user explicitly requests further payment steps.'})

    if not state.get('visibleButtons'):
        observations.append({'level': 'warning', 'code': 'NO_VISIBLE_BUTTONS', 'message': 'No visible buttons were detected after the action.'})

    return observations


def build_action_diff(before: dict, after: dict) -> dict:
    before_buttons = set(_normalize([
        (btn.get('text') or btn.get('ariaLabel') or '') for btn in before.get('visibleButtons', [])
    ]))
    after_buttons = _normalize([
        (btn.get('text') or btn.get('ariaLabel') or '') for btn in after.get('visibleButtons', [])
    ])
    before_texts = set(_normalize(before.get('visibleTexts', [])))
    after_texts = _normalize(after.get('visibleTexts', []))

    return {
        'urlChanged': before.get('url') != after.get('url'),
        'titleChanged': before.get('title') != after.get('title'),
        'pageSignatureChanged': before.get('pageSignatureGuess') != after.get('pageSignatureGuess'),
        'addedButtons': [t for t in after_buttons if t not in before_buttons][:8],
        'removedButtons': [t for t in before_buttons if t not in after_buttons][:8],
        'addedTexts': [t for t in after_texts if t not in before_texts][:8],
        'removedTexts': [t for t in before_texts if t not in after_texts][:8],
    }
