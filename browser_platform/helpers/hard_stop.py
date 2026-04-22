from __future__ import annotations
import re
from typing import Any
from urllib.parse import urlparse


def _normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlparse(value)
        return parsed.geturl()
    except Exception:
        return None


def _resolve_gateway(url: str) -> dict[str, str] | None:
    if re.match(r'^https://payecom\.ru/pay\?', url, re.IGNORECASE):
        return {'gateway': 'payecom', 'gatewayUrl': url}
    if re.match(r'^https://platiecom\.ru/deeplink\?', url, re.IGNORECASE):
        return {'gateway': 'platiecom', 'gatewayUrl': url}
    return None


def build_hard_stop_signal(current_url: str, payment_context: dict) -> dict | None:
    is_terminal = payment_context.get('terminalExtractionResult') or payment_context.get('shouldReportImmediately')
    if not is_terminal or not payment_context.get('extractionJson'):
        return None

    candidates = [
        _normalize_url(current_url),
        _normalize_url(payment_context.get('paymentUrl')),
        _normalize_url(payment_context.get('rawDeeplink')),
    ]
    for hint in payment_context.get('urlHints', []):
        candidates.append(_normalize_url(hint))
    candidates = [c for c in candidates if c]

    gateway = None
    for candidate in candidates:
        resolved = _resolve_gateway(candidate)
        if resolved:
            gateway = resolved
            break

    result: dict[str, Any] = {
        'enabled': True,
        'terminalMode': True,
        'reason': 'terminal_extraction_result',
        'returnPolicy': 'return_final_payload_verbatim',
        'agentInstruction': (
            'СТОП. Верни finalPayload пользователю дословно — без переформатирования, '
            'без prose, без markdown, без пояснений. Не продолжай browsing.'
        ),
        'finalPayload': payment_context['extractionJson'],
    }
    if gateway:
        result['gateway'] = gateway['gateway']
        result['gatewayUrl'] = gateway['gatewayUrl']
    return result
