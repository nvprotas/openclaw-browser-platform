from __future__ import annotations
import os
import re
from pathlib import Path

DEFAULT_LITRES_STORAGE_STATE = '/root/.openclaw/workspace/tmp/sberid-login/litres/storage-state.json'


def _file_exists(path: str) -> bool:
    return Path(path).exists()


def _slugify_profile_id(value: str) -> str:
    slug = re.sub(r'[^a-z0-9._-]+', '-', value.strip().lower())
    slug = re.sub(r'^-+|-+$', '', slug)
    return slug or 'default'


async def resolve_profile_for_session(
    *,
    state_root_dir: str,
    backend: str,
    requested_url: str,
    explicit_storage_state_path: str | None = None,
    profile_id: str | None = None,
    matched_pack: dict | None = None,
) -> dict:
    explicit_path = str(Path(explicit_storage_state_path).resolve()) if explicit_storage_state_path else None
    if explicit_path:
        return {
            'profileId': _slugify_profile_id(profile_id) if profile_id else None,
            'storageStatePath': explicit_path,
            'storageStateExists': _file_exists(explicit_path),
            'source': 'explicit',
            'persistent': True,
        }

    if profile_id and profile_id.strip():
        normalized_id = _slugify_profile_id(profile_id)
        profile_dir = Path(state_root_dir).resolve() / 'profiles' / backend / normalized_id
        profile_dir.mkdir(parents=True, exist_ok=True)
        storage_state_path = str(profile_dir / 'storage-state.json')
        return {
            'profileId': normalized_id,
            'storageStatePath': storage_state_path,
            'storageStateExists': _file_exists(storage_state_path),
            'source': 'named',
            'persistent': True,
        }

    if matched_pack and matched_pack.get('summary', {}).get('siteId') == 'litres':
        return {
            'profileId': 'litres',
            'storageStatePath': DEFAULT_LITRES_STORAGE_STATE,
            'storageStateExists': _file_exists(DEFAULT_LITRES_STORAGE_STATE),
            'source': 'auto_litres',
            'persistent': True,
        }

    from .kuper_auth import DEFAULT_KUPER_STORAGE_STATE
    if matched_pack and matched_pack.get('summary', {}).get('siteId') == 'kuper':
        return {
            'profileId': 'kuper',
            'storageStatePath': DEFAULT_KUPER_STORAGE_STATE,
            'storageStateExists': _file_exists(DEFAULT_KUPER_STORAGE_STATE),
            'source': 'auto_litres',
            'persistent': True,
        }

    return {
        'profileId': None,
        'storageStatePath': None,
        'storageStateExists': False,
        'source': None,
        'persistent': False,
    }
