from __future__ import annotations
import json
import re


def _unique(values: list) -> list:
    seen: set[str] = set()
    result = []
    for v in values:
        key = json.dumps(v, sort_keys=True)
        if key not in seen:
            seen.add(key)
            result.append(v)
    return result


def _read_pack_strings(pack: dict | None, section: str, key: str) -> list[str]:
    if not pack:
        return []
    raw = pack.get('pack', {}).get('hints', {}).get('raw', {})
    bucket = raw.get(section)
    if not bucket or not isinstance(bucket, dict):
        return []
    values = bucket.get(key)
    if isinstance(values, list):
        return [v for v in values if isinstance(v, str)]
    return []


def find_add_to_cart_targets(pack: dict | None) -> list[dict]:
    selectors = _read_pack_strings(pack, 'selectors', 'add_to_cart')
    button_texts = _read_pack_strings(pack, 'button_texts', 'add_to_cart')
    return _unique(
        [{'action': 'click', 'selector': s} for s in selectors]
        + [{'action': 'click', 'role': 'button', 'name': t} for t in button_texts]
        + [{'action': 'click', 'text': t} for t in button_texts]
    )


def find_open_cart_targets(pack: dict | None) -> list[dict]:
    selectors = _read_pack_strings(pack, 'selectors', 'cart_link')
    button_texts = _read_pack_strings(pack, 'button_texts', 'open_cart')
    return _unique(
        [{'action': 'click', 'selector': s} for s in selectors]
        + [{'action': 'click', 'role': 'button', 'name': t} for t in button_texts]
        + [{'action': 'click', 'role': 'link', 'name': t} for t in button_texts]
        + [{'action': 'click', 'text': t} for t in button_texts]
    )


def is_add_to_cart_confirmed(input_data: dict) -> bool:
    before = input_data.get('before', {})
    after = input_data.get('after', {})
    changes = input_data.get('changes', {})
    observations = input_data.get('observations', [])

    codes = {obs['code'] for obs in observations}

    if 'CART_VISIBLE' in codes:
        return True
    if after.get('pageSignatureGuess') == 'cart':
        return True
    if changes.get('urlChanged') or changes.get('pageSignatureChanged'):
        if after.get('pageSignatureGuess') == 'cart':
            return True
    if any(re.search(r'added to cart|добавлен[ао]? в корзин|в корзину', t, re.IGNORECASE) for t in changes.get('addedTexts', [])):
        return True
    if any(re.search(r'added|added to cart|в корзин|в корзине|перейти в корзину', t, re.IGNORECASE) for t in changes.get('addedButtons', [])):
        return True
    if any(re.search(r'в корзину|купить|add to cart|buy', t, re.IGNORECASE) for t in changes.get('removedButtons', [])):
        return True
    if any(re.search(r'ваша корзина|состав заказа|оформить заказ|added to cart|добавлен[ао]? в корзин', t, re.IGNORECASE) for t in after.get('visibleTexts', [])):
        return True

    cart_counter_pattern = re.compile(r'\b(\d+)\s+корзин(?:а|е|у|ы)?\b', re.IGNORECASE)
    before_match = cart_counter_pattern.search(' '.join(before.get('visibleTexts', [])))
    after_match = cart_counter_pattern.search(' '.join(after.get('visibleTexts', [])))
    if after_match and (not before_match or after_match.group(1) != before_match.group(1)):
        return True

    return False


def is_cart_visible(observation: dict) -> bool:
    if observation.get('pageSignatureGuess') == 'cart':
        return True
    if re.search(r'/cart\b|/basket\b', observation.get('url', ''), re.IGNORECASE):
        return True
    return any(re.search(r'корзин|your cart|basket|оформить заказ|состав заказа', t, re.IGNORECASE)
               for t in observation.get('visibleTexts', []))
