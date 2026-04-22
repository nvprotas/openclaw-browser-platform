from __future__ import annotations
import json
from ..core.errors import BrowserPlatformError


def print_json(payload: object) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def print_error_json(error: Exception) -> None:
    if isinstance(error, BrowserPlatformError):
        print_json({'ok': False, 'error': {
            'code': error.code,
            'message': error.message,
            'details': error.details,
        }})
        return
    message = str(error) if error else 'Unknown error'
    print_json({'ok': False, 'error': {
        'code': 'UNEXPECTED_ERROR',
        'message': message,
        'details': None,
    }})
