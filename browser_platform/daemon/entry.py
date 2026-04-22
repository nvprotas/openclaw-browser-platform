from __future__ import annotations
import asyncio
from .server import start_daemon_server


async def main() -> None:
    await start_daemon_server()
    await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
