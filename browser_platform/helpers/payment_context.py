from __future__ import annotations
import re
from typing import Any
from urllib.parse import urlparse, parse_qs, urlencode, quote, unquote, urljoin

_PAYMENT_URL_PATTERN = re.compile(
    r'https?://(?:www\.)?(?:payecom\.ru/pay(?:_ru)?|platiecom\.ru/deeplink)[^\s"\'<>)]*',
    re.IGNORECASE
)
_PAYMENT_PARAM_PATTERN = re.compile(
    r'(orderid|bankinvoiceid|merchantordernumber|merchantorderid|mdorder|formurl|href|order|trace-id|method|system)=([^\s&"\'<>]+)',
    re.IGNORECASE
)
_PAYMENT_HOST_PATTERN = re.compile(r'^(?:https?://|/|%2f%2f|https?%3a%2f%2f)', re.IGNORECASE)


def _uniq(values: list[str | None]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for v in values:
        s = (v or '').strip()
        if s and s not in seen:
            seen.add(s)
            result.append(s)
    return result


def _first(values: list[str]) -> str | None:
    return values[0] if values else None


def _deep_decode(text: str) -> str:
    current = text
    for _ in range(3):
        try:
            decoded = unquote(current)
            if decoded == current:
                break
            current = decoded
        except Exception:
            break
    return current


def _to_absolute_url(candidate: str, base_url: str) -> str | None:
    try:
        return urljoin(base_url, candidate)
    except Exception:
        return None


def _is_relevant_payment_url(value: str) -> bool:
    if not _PAYMENT_HOST_PATTERN.match(value):
        return False
    decoded = _deep_decode(value)
    return bool(re.search(r'payecom\.ru|platiecom\.ru|id\.sber\.ru', decoded, re.IGNORECASE))


def _is_relevant_gateway_url(value: str) -> bool:
    if not _PAYMENT_HOST_PATTERN.match(value):
        return False
    decoded = _deep_decode(value)
    return bool(re.search(r'payecom\.ru|platiecom\.ru', decoded, re.IGNORECASE))


def _collect_known_params(url_obj: Any, acc: dict[str, list[str]]) -> None:
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(str(url_obj))
    params = parse_qs(parsed.query, keep_blank_values=False)
    for key, vals in params.items():
        lowered = key.lower()
        for value in vals:
            if lowered == 'orderid':
                acc['orderIds'].append(value)
            elif lowered == 'bankinvoiceid':
                acc['bankInvoiceIds'].append(value)
            elif lowered == 'merchantordernumber':
                acc['merchantOrderNumbers'].append(value)
            elif lowered == 'merchantorderid':
                acc['merchantOrderIds'].append(value)
            elif lowered == 'mdorder':
                acc['mdOrders'].append(value)
            elif lowered == 'formurl':
                decoded = _deep_decode(value)
                if _is_relevant_gateway_url(decoded):
                    acc['formUrls'].append(decoded)
            elif lowered == 'href':
                decoded = _deep_decode(value)
                if _is_relevant_payment_url(decoded):
                    acc['hrefs'].append(decoded)
            elif lowered == 'order':
                acc['litresOrders'].append(value)
            elif lowered == 'trace-id':
                acc['traceIds'].append(value)
            elif lowered == 'method':
                acc['paymentMethods'].append(value)
            elif lowered == 'system':
                acc['paymentSystems'].append(value)


def _collect_param_pair(key: str, raw_value: str, acc: dict[str, list[str]]) -> None:
    lowered = key.lower()
    value = _deep_decode(raw_value).strip()
    if not value:
        return
    if lowered == 'orderid':
        acc['orderIds'].append(value)
    elif lowered == 'bankinvoiceid':
        acc['bankInvoiceIds'].append(value)
    elif lowered == 'merchantordernumber':
        acc['merchantOrderNumbers'].append(value)
    elif lowered == 'merchantorderid':
        acc['merchantOrderIds'].append(value)
    elif lowered == 'mdorder':
        acc['mdOrders'].append(value)
    elif lowered == 'formurl':
        if _is_relevant_gateway_url(value):
            acc['formUrls'].append(value)
            _collect_candidate(value, 'https://payecom.ru/', acc)
    elif lowered == 'href':
        if _is_relevant_payment_url(value):
            acc['hrefs'].append(value)
            _collect_candidate(value, 'https://payecom.ru/', acc)
    elif lowered == 'order':
        acc['litresOrders'].append(value)
    elif lowered == 'trace-id':
        acc['traceIds'].append(value)
    elif lowered == 'method':
        acc['paymentMethods'].append(value)
    elif lowered == 'system':
        acc['paymentSystems'].append(value)


def _collect_loose_signals(raw: str, base_url: str, acc: dict[str, list[str]]) -> None:
    variants = _uniq([raw, _deep_decode(raw)])
    for variant in variants:
        for m in _PAYMENT_URL_PATTERN.finditer(variant):
            _collect_candidate(m.group(0), base_url, acc)
        for m in _PAYMENT_PARAM_PATTERN.finditer(variant):
            _collect_param_pair(m.group(1), m.group(2), acc)
        if re.search(r'id\.sber\.ru/.+authorize', variant, re.IGNORECASE):
            href_match = re.search(r'https?://id\.sber\.ru/[^\s"\'<>)]*', variant, re.IGNORECASE)
            if href_match:
                acc['hrefs'].append(_deep_decode(href_match.group(0)))


def _parse_encoded_params(raw: str, acc: dict[str, list[str]]) -> None:
    from urllib.parse import parse_qs
    variants = _uniq([raw, _deep_decode(raw)])
    for variant in variants:
        try:
            query = variant[1:] if variant.startswith('?') else variant
            params = parse_qs(query, keep_blank_values=False)
            for key, vals in params.items():
                for v in vals:
                    _collect_param_pair(key, v, acc)
        except Exception:
            pass


def _collect_candidate(candidate: str, base_url: str, acc: dict[str, list[str]]) -> None:
    absolute = _to_absolute_url(candidate, base_url)
    if not absolute:
        return
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(absolute)
        href = absolute
        _collect_known_params(absolute, acc)

        if re.search(r'payecom\.ru/pay(?:_ru)?', href, re.IGNORECASE):
            acc['paymentUrls'].append(href)

        if re.search(r'platiecom\.ru/deeplink', href, re.IGNORECASE):
            acc['rawDeeplinks'].append(href)
            params = parse_qs(parsed.query)
            for v in params.get('params', []):
                _parse_encoded_params(v, acc)

        if re.search(r'id\.sber\.ru/.+authorize', href, re.IGNORECASE):
            acc['hrefs'].append(href)
    except Exception:
        pass


def _build_payment_intents(order_ids: list[str]) -> list[dict[str, str]]:
    return [{'provider': 'sberpay', 'orderId': oid} for oid in _uniq(order_ids)]


def _pick_extraction_source(
    payment_url: str | None,
    raw_deeplink: str | None,
    bank_invoice_id: str | None,
    merchant_order_number: str | None,
    merchant_order_id: str | None,
    md_order: str | None,
    form_url: str | None,
) -> str:
    if raw_deeplink:
        return 'deeplink'
    if bank_invoice_id or merchant_order_number or merchant_order_id or md_order or form_url:
        return 'network_response'
    return 'url'


def _build_extraction_json(
    provider: str | None,
    payment_url: str | None,
    payment_order_id: str | None,
    payment_intents: list[dict],
    bank_invoice_id: str | None,
    merchant_order_number: str | None,
    merchant_order_id: str | None,
    raw_deeplink: str | None,
    md_order: str | None,
    form_url: str | None,
    href: str | None,
) -> dict | None:
    if provider != 'sberpay':
        return None
    return {
        'paymentMethod': 'SberPay',
        'paymentUrl': payment_url,
        'paymentOrderId': payment_order_id,
        'paymentIntents': payment_intents,
        'bankInvoiceId': bank_invoice_id,
        'merchantOrderNumber': merchant_order_number,
        'merchantOrderId': merchant_order_id,
        'rawDeeplink': raw_deeplink,
        'source': _pick_extraction_source(payment_url, raw_deeplink, bank_invoice_id, merchant_order_number, merchant_order_id, md_order, form_url),
        'mdOrder': md_order,
        'formUrl': form_url,
        'href': href,
    }


def create_empty_payment_context() -> dict:
    return {
        'detected': False,
        'shouldReportImmediately': False,
        'terminalExtractionResult': False,
        'provider': None,
        'phase': None,
        'paymentMethod': None,
        'paymentSystem': None,
        'paymentUrl': None,
        'paymentOrderId': None,
        'litresOrder': None,
        'traceId': None,
        'bankInvoiceId': None,
        'merchantOrderNumber': None,
        'merchantOrderId': None,
        'mdOrder': None,
        'formUrl': None,
        'rawDeeplink': None,
        'href': None,
        'urlHints': [],
        'paymentIntents': [],
        'extractionJson': None,
    }


def extract_payment_context(input_data: dict) -> dict:
    url = input_data.get('url', '')
    visible_texts = input_data.get('visibleTexts', [])
    visible_buttons = input_data.get('visibleButtons', [])
    forms = input_data.get('forms', [])
    url_hints_raw = input_data.get('urlHints', [])

    acc: dict[str, list[str]] = {
        'paymentUrls': [],
        'orderIds': [],
        'bankInvoiceIds': [],
        'merchantOrderNumbers': [],
        'merchantOrderIds': [],
        'mdOrders': [],
        'formUrls': [],
        'rawDeeplinks': [],
        'hrefs': [],
        'litresOrders': [],
        'traceIds': [],
        'paymentMethods': [],
        'paymentSystems': [],
    }

    form_action_hints = [
        _to_absolute_url(form['action'], url)
        for form in forms
        if form.get('action')
    ]
    form_action_hints = [h for h in form_action_hints if h]

    url_hints = _uniq(url_hints_raw)
    candidates = _uniq([url] + url_hints + [h for h in form_action_hints if h])
    for candidate in candidates:
        _collect_candidate(candidate, url, acc)

    combined_parts = [' '.join(visible_texts)]
    for btn in visible_buttons:
        parts = [
            btn.get('text', ''),
            btn.get('ariaLabel', '') or '',
            btn.get('href', '') or '',
            btn.get('formAction', '') or '',
        ]
        parts.extend(btn.get('paymentHints', []) or [])
        parts.extend((btn.get('dataAttributes', {}) or {}).values())
        combined_parts.append(' '.join(parts).strip())
    for form in forms:
        combined_parts.extend([
            form.get('id', '') or '',
            form.get('name', '') or '',
            form.get('action', '') or '',
        ])
        combined_parts.extend(form.get('submitLabels', []))
    combined_text_raw = ' '.join(combined_parts)

    _collect_loose_signals(combined_text_raw, url, acc)
    for hint in url_hints:
        _collect_loose_signals(hint, url, acc)

    combined_text = combined_text_raw.lower()

    payment_url = _first(_uniq(acc['paymentUrls'] + acc['formUrls']))
    payment_order_id = _first(_uniq(acc['orderIds'] + acc['mdOrders']))
    litres_order = _first(_uniq(acc['litresOrders']))
    trace_id = _first(_uniq(acc['traceIds']))
    payment_method = _first(_uniq(acc['paymentMethods']))
    payment_system = _first(_uniq(acc['paymentSystems']))
    bank_invoice_id = _first(_uniq(acc['bankInvoiceIds']))
    merchant_order_number = _first(_uniq(acc['merchantOrderNumbers']))
    merchant_order_id = _first(_uniq(acc['merchantOrderIds']))
    md_order = _first(_uniq(acc['mdOrders']))
    form_url = _first(_uniq(acc['formUrls']))
    raw_deeplink = _first(_uniq(acc['rawDeeplinks']))
    href = _first(_uniq(acc['hrefs']))
    payment_intents = _build_payment_intents(acc['orderIds'] + acc['mdOrders'])

    sber_id_handoff_visible = bool(href) or any(
        re.search(r'id\.sber\.ru/.+authorize', hint, re.IGNORECASE) for hint in url_hints
    )
    checkout_url_visible = bool(re.search(r'/purchase/ppd\b', url, re.IGNORECASE))
    has_structured_payment_evidence = bool(
        payment_url or payment_order_id or litres_order or trace_id
        or bank_invoice_id or merchant_order_number or merchant_order_id
        or md_order or form_url or raw_deeplink
    )
    allow_sber_id_only_signals = checkout_url_visible or has_structured_payment_evidence

    phase = None
    if re.search(r'platiecom\.ru/deeplink', url, re.IGNORECASE) or raw_deeplink:
        phase = 'platiecom_deeplink'
    elif re.search(r'payecom\.ru/pay(?:_ru)?', url, re.IGNORECASE):
        phase = 'payecom_boundary'
    elif checkout_url_visible or payment_url or raw_deeplink or (allow_sber_id_only_signals and sber_id_handoff_visible):
        phase = 'litres_checkout'

    provider = None
    if (
        re.search(r'войти по сбер id|сбер id|сберпей', combined_text)
        or payment_url
        or raw_deeplink
        or (allow_sber_id_only_signals and href and re.search(r'id\.sber\.ru/.+authorize', href, re.IGNORECASE))
    ):
        provider = 'sberpay'
    elif payment_method == 'sbp' or payment_system == 'sbersbp':
        provider = 'sbp'

    detected = bool(phase or has_structured_payment_evidence or (allow_sber_id_only_signals and href))

    extraction_json = _build_extraction_json(
        provider, payment_url, payment_order_id, payment_intents,
        bank_invoice_id, merchant_order_number, merchant_order_id,
        raw_deeplink, md_order, form_url, href,
    )

    terminal_extraction_result = bool(
        extraction_json and any(
            extraction_json.get(k)
            for k in ['paymentOrderId', 'paymentUrl', 'bankInvoiceId', 'merchantOrderNumber',
                      'merchantOrderId', 'mdOrder', 'formUrl', 'rawDeeplink', 'href']
        )
    )

    return {
        'detected': detected,
        'shouldReportImmediately': terminal_extraction_result,
        'terminalExtractionResult': terminal_extraction_result,
        'provider': provider,
        'phase': phase,
        'paymentMethod': payment_method,
        'paymentSystem': payment_system,
        'paymentUrl': payment_url,
        'paymentOrderId': payment_order_id,
        'litresOrder': litres_order,
        'traceId': trace_id,
        'bankInvoiceId': bank_invoice_id,
        'merchantOrderNumber': merchant_order_number,
        'merchantOrderId': merchant_order_id,
        'mdOrder': md_order,
        'formUrl': form_url,
        'rawDeeplink': raw_deeplink,
        'href': href,
        'urlHints': url_hints,
        'paymentIntents': payment_intents,
        'extractionJson': extraction_json,
    }
