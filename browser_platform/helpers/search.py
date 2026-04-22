from __future__ import annotations
import json
import re


def _normalize_text(value: str) -> str:
    result = value.lower()
    result = result.replace('ё', 'е')
    result = re.sub(r'[^\w\s]', ' ', result)
    result = re.sub(r'\s+', ' ', result).strip()
    return result


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


def find_search_input(pack: dict | None) -> list[dict]:
    selectors = _read_pack_strings(pack, 'selectors', 'search_input')
    return _unique(
        [{'action': 'fill', 'selector': s, 'value': ''} for s in selectors]
        + [
            {'action': 'fill', 'role': 'combobox', 'value': ''},
            {'action': 'fill', 'role': 'searchbox', 'value': ''},
            {'action': 'fill', 'role': 'textbox', 'name': 'Найти', 'value': ''},
            {'action': 'fill', 'role': 'textbox', 'name': 'Search', 'value': ''},
            {'action': 'fill', 'selector': 'input[name="q"]', 'value': ''},
        ]
    )


def fill_search_and_submit(pack: dict | None, query: str) -> dict:
    fill_targets = _unique([{**t, 'value': query} for t in find_search_input(pack)])
    submit_selectors = _read_pack_strings(pack, 'selectors', 'search_submit')
    submit_texts = _read_pack_strings(pack, 'button_texts', 'search_submit')
    submit_targets = _unique(
        [{'action': 'click', 'selector': s} for s in submit_selectors]
        + [{'action': 'click', 'role': 'button', 'name': t} for t in submit_texts]
        + [{'action': 'click', 'text': t} for t in submit_texts]
    )
    return {'fillTargets': fill_targets, 'submitTargets': submit_targets}


def _score_candidate(candidate: str, query: str) -> float:
    nc = _normalize_text(candidate)
    nq = _normalize_text(query)
    if not nc or not nq:
        return -1
    if nc == nq:
        return 100
    candidate_tokens = set(nc.split())
    query_tokens = nq.split()
    matched = [t for t in query_tokens if t in candidate_tokens]
    contains_query = nq in nc
    result_word_bonus = 8 if re.search(r'result|results|найден|результат|книга|book', nc) else 0
    return len(matched) * 20 + (25 if contains_query else 0) + result_word_bonus - len(nc) / 200


def choose_search_result_target(observation: dict, query: str) -> dict | None:
    if observation.get('pageSignatureGuess') != 'search_results':
        return None

    texts = list({t: None for t in observation.get('visibleTexts', [])}.keys())
    candidates = [
        {'text': t, 'score': _score_candidate(t, query)}
        for t in texts
        if len(t) >= 2
        and not re.search(r'результаты поиска|search results|найдено|найти|поиск|фильтр|filters?', t, re.IGNORECASE)
    ]
    candidates = [c for c in candidates if c['score'] > 0]
    candidates.sort(key=lambda c: c['score'], reverse=True)
    if not candidates:
        return None
    return {'action': 'click', 'text': candidates[0]['text']}
