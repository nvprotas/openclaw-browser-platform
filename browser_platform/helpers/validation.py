from __future__ import annotations
import json
import re
from .tracing import summarize_observation, build_action_diff
from .hard_stop import build_hard_stop_signal


def _payment_fingerprint(context: dict) -> str:
    return json.dumps({
        'phase': context.get('phase'),
        'paymentOrderId': context.get('paymentOrderId'),
        'litresOrder': context.get('litresOrder'),
        'traceId': context.get('traceId'),
        'bankInvoiceId': context.get('bankInvoiceId'),
        'merchantOrderNumber': context.get('merchantOrderNumber'),
        'merchantOrderId': context.get('merchantOrderId'),
        'mdOrder': context.get('mdOrder'),
        'formUrl': context.get('formUrl'),
        'rawDeeplink': context.get('rawDeeplink'),
        'href': context.get('href'),
    })


def _summarize_payment_context(context: dict) -> str:
    if context.get('extractionJson'):
        return json.dumps(context['extractionJson'])
    parts = []
    for key, label in [
        ('paymentOrderId', 'paymentOrderId'),
        ('litresOrder', 'litresOrder'),
        ('traceId', 'traceId'),
        ('bankInvoiceId', 'bankInvoiceId'),
        ('mdOrder', 'mdOrder'),
        ('formUrl', 'formUrl'),
        ('merchantOrderId', 'merchantOrderId'),
        ('merchantOrderNumber', 'merchantOrderNumber'),
    ]:
        v = context.get(key)
        if v:
            parts.append(f'{label}={v}')
    return ', '.join(parts)


def build_post_action_observations(before: dict, after: dict) -> list[dict]:
    observations = summarize_observation(after)
    diff = build_action_diff(before, after)

    if diff['urlChanged']:
        observations.append({'level': 'info', 'code': 'URL_CHANGED', 'message': f'URL changed to {after.get("url")}'})
    if diff['titleChanged']:
        observations.append({'level': 'info', 'code': 'TITLE_CHANGED', 'message': f'Title changed to {after.get("title")}'})

    after_pc = after.get('paymentContext', {})
    is_terminal = after_pc.get('terminalExtractionResult') or after_pc.get('shouldReportImmediately')
    hard_stop = build_hard_stop_signal(after.get('url', ''), after_pc)

    before_pc = before.get('paymentContext', {})
    if is_terminal and _payment_fingerprint(before_pc) != _payment_fingerprint(after_pc):
        observations.append({
            'level': 'warning',
            'code': 'PAYMENT_IDS_DETECTED',
            'message': f'СТОП: обнаружены payment identifiers. Верни extractionJson дословно без prose: {_summarize_payment_context(after_pc)}'
        })

    if hard_stop:
        gateway_info = f' ({hard_stop["gateway"]})' if hard_stop.get('gateway') else ''
        observations.append({
            'level': 'warning',
            'code': 'HARD_STOP_TERMINAL_EXTRACTION_RESULT',
            'message': f'TERMINAL HARD STOP{gateway_info}: return hardStop.finalPayload JSON verbatim and do not continue normal flow.'
        })

    if not diff['urlChanged'] and not diff['titleChanged'] and not diff['pageSignatureChanged'] and not diff['addedButtons'] and not diff['addedTexts']:
        payment_flow_still_active = (
            after_pc.get('phase') in ('litres_checkout', 'payecom_boundary')
            or any(re.search(r'войти по сбер id', t, re.IGNORECASE) for t in after.get('visibleTexts', []))
        )
        observations.append({
            'level': 'info' if payment_flow_still_active else 'warning',
            'code': 'PAYMENT_FLOW_STILL_ACTIVE' if payment_flow_still_active else 'NO_OBVIOUS_CHANGE',
            'message': (
                'The payment flow is still active, but the page did not produce a clear navigation-level change yet.'
                if payment_flow_still_active
                else 'No obvious page change was detected after the action.'
            )
        })

    return observations
