from __future__ import annotations
import asyncio
from typing import Any, Callable, TypeVar

T = TypeVar('T')


async def with_retry(operation: Callable[[], Any], attempts: int = 2) -> Any:
    last_error: BaseException | None = None
    for index in range(attempts):
        try:
            return await operation()
        except Exception as error:
            last_error = error
            if index < attempts - 1:
                await asyncio.sleep(0.15)
    raise last_error
