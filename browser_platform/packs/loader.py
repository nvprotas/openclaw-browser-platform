from __future__ import annotations
import json
from pathlib import Path
from urllib.parse import urlparse

from .manifest import normalize_manifest, build_pack_summary
from .instructions import parse_instructions
from .hints import parse_hints


def _get_default_site_packs_root() -> Path:
    here = Path(__file__).parent
    current = here
    while True:
        candidate = current / 'site-packs'
        if candidate.exists():
            return candidate
        parent = current.parent
        if parent == current:
            raise RuntimeError(f'Unable to locate site-packs directory from {here}')
        current = parent


def load_site_pack(root_dir: Path | str) -> dict:
    root_dir = Path(root_dir)
    manifest_raw = json.loads((root_dir / 'manifest.json').read_text('utf-8'))
    instructions_raw = (root_dir / 'instructions.md').read_text('utf-8')
    hints_raw = json.loads((root_dir / 'hints.json').read_text('utf-8'))
    return {
        'rootDir': str(root_dir),
        'manifest': normalize_manifest(manifest_raw),
        'instructions': parse_instructions(instructions_raw),
        'hints': parse_hints(hints_raw),
    }


def load_all_site_packs(site_packs_root: Path | str | None = None) -> list[dict]:
    resolved_root = Path(site_packs_root) if site_packs_root else _get_default_site_packs_root()
    dirs = [entry for entry in resolved_root.iterdir() if entry.is_dir()]
    return [load_site_pack(d) for d in dirs]


def match_site_pack_by_url(url: str, site_packs_root: Path | str | None = None) -> dict | None:
    hostname = urlparse(url).hostname.lower() if urlparse(url).hostname else ''
    packs = load_all_site_packs(site_packs_root)

    matched = next(
        (
            pack for pack in packs
            if any(
                hostname == d.lower() or hostname.endswith(f'.{d.lower()}')
                for d in pack['manifest']['domains']
            )
        ),
        None,
    )
    if not matched:
        return None

    matched_domain = next(
        (
            d for d in matched['manifest']['domains']
            if hostname == d.lower() or hostname.endswith(f'.{d.lower()}')
        ),
        matched['manifest']['domains'][0] if matched['manifest']['domains'] else hostname,
    )

    return {
        'pack': matched,
        'summary': build_pack_summary(matched['manifest'], matched_domain),
        'instructionsSummary': matched['instructions']['summary'],
        'knownSignals': matched['hints']['knownSignals'],
    }
