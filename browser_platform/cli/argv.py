from __future__ import annotations
from ..core.errors import BrowserPlatformError


def require_flag(args: list[str], flag: str) -> str:
    try:
        index = args.index(flag)
    except ValueError:
        raise BrowserPlatformError(f'Missing required flag: {flag}', code='MISSING_FLAG')
    if index >= len(args) - 1:
        raise BrowserPlatformError(f'Missing required flag: {flag}', code='MISSING_FLAG')
    return args[index + 1]


def has_flag(args: list[str], flag: str) -> bool:
    return flag in args


def optional_flag(args: list[str], name: str) -> str | None:
    try:
        index = args.index(name)
    except ValueError:
        return None
    if index >= len(args) - 1:
        return None
    return args[index + 1]
