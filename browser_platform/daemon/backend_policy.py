from __future__ import annotations
from urllib.parse import urlparse

_CHROMIUM_ALLOWLIST_DOMAINS = {'example.com', 'litres.ru'}


def _is_allowlisted_domain(hostname: str) -> bool:
    return any(
        hostname == d or hostname.endswith(f'.{d}')
        for d in _CHROMIUM_ALLOWLIST_DOMAINS
    )


def resolve_backend_for_session(
    *,
    requested_url: str,
    matched_pack: dict | None = None,
    profile_id: str | None = None,
    scenario_id: str | None = None,
) -> dict:
    try:
        hostname = urlparse(requested_url).hostname.lower()
    except Exception:
        return {'selectedBackend': 'camoufox', 'matchedRule': 'default_camoufox'}

    matched_domain = None
    if matched_pack and matched_pack.get('summary', {}).get('matchedDomain'):
        matched_domain = matched_pack['summary']['matchedDomain'].lower()

    if _is_allowlisted_domain(hostname) or (matched_domain and _is_allowlisted_domain(matched_domain)):
        return {'selectedBackend': 'chromium', 'matchedRule': 'allowlist_domain_chromium'}

    return {'selectedBackend': 'camoufox', 'matchedRule': 'default_camoufox'}
