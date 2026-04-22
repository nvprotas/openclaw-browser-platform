from typing import Any


class BrowserPlatformError(Exception):
    def __init__(self, message: str, *, code: str = 'BROWSER_PLATFORM_ERROR', details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details
