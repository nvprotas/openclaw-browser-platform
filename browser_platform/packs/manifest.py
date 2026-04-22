from __future__ import annotations


def normalize_manifest(input_data: object) -> dict:
    if not input_data or not isinstance(input_data, dict):
        raise ValueError('Invalid site pack manifest: expected object')
    m = input_data
    site_id = m.get('site_id')
    domains = m.get('domains')
    start_url = m.get('start_url')
    site_type = m.get('site_type')
    support_level = m.get('support_level')
    flows = m.get('flows')
    risk_flags = m.get('risk_flags')

    if not isinstance(site_id, str) or not site_id:
        raise ValueError('Invalid site pack manifest: site_id must be a non-empty string')
    if not isinstance(domains, list) or any(not isinstance(d, str) for d in domains):
        raise ValueError('Invalid site pack manifest: domains must be a string array')
    if not isinstance(start_url, str) or not start_url:
        raise ValueError('Invalid site pack manifest: start_url must be a non-empty string')
    if not isinstance(site_type, str) or not site_type:
        raise ValueError('Invalid site pack manifest: site_type must be a non-empty string')
    if support_level not in ('generic', 'profiled', 'assisted', 'hardened'):
        raise ValueError('Invalid site pack manifest: support_level must be a known value')
    if not isinstance(flows, list) or any(not isinstance(f, str) for f in flows):
        raise ValueError('Invalid site pack manifest: flows must be a string array')
    if not isinstance(risk_flags, dict) or isinstance(risk_flags, list):
        raise ValueError('Invalid site pack manifest: risk_flags must be an object')

    return {
        'site_id': site_id,
        'domains': domains,
        'start_url': start_url,
        'site_type': site_type,
        'support_level': support_level,
        'flows': flows,
        'risk_flags': risk_flags,
    }


def build_pack_summary(manifest: dict, matched_domain: str) -> dict:
    return {
        'siteId': manifest['site_id'],
        'supportLevel': manifest['support_level'],
        'matchedDomain': matched_domain,
        'startUrl': manifest['start_url'],
        'flows': list(manifest['flows']),
        'riskFlags': [k for k, v in manifest['risk_flags'].items() if v],
    }
