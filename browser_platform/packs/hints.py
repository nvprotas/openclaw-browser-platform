from __future__ import annotations


def parse_hints(input_data: object) -> dict:
    raw = input_data if isinstance(input_data, dict) and not isinstance(input_data, list) else {}

    raw_sigs = raw.get('page_signatures')
    if raw_sigs and isinstance(raw_sigs, dict) and not isinstance(raw_sigs, list):
        page_signatures = {
            k: [item for item in v if isinstance(item, str)] if isinstance(v, list) else []
            for k, v in raw_sigs.items()
        }
    else:
        page_signatures = {}

    known_signals = list(page_signatures.keys())
    for signals in page_signatures.values():
        known_signals.extend(signals)

    return {
        'pageSignatures': page_signatures,
        'knownSignals': known_signals,
        'raw': raw,
    }
