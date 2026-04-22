from __future__ import annotations
import asyncio

from ..core.errors import BrowserPlatformError
from .output import print_json, print_error_json
from .commands.daemon import handle_daemon_ensure, handle_daemon_status
from .commands.session import (
    handle_session_act,
    handle_session_close,
    handle_session_context,
    handle_session_observe,
    handle_session_open,
    handle_session_snapshot,
)

_HELP_TEXT = """\
browser-platform

Usage:
  browser-platform daemon ensure --json
  browser-platform daemon status --json
  browser-platform session open --url <url> [--profile <id>] [--scenario <id>] [--backend camoufox|chromium] [--storage-state <path>] --json
  browser-platform session context --session <id> --json
  browser-platform session observe --session <id> --json
  browser-platform session act --session <id> --json '<payload>'
  browser-platform session snapshot --session <id> --json
  browser-platform session close --session <id> --json

Notes:
  --profile + --scenario is the canonical session model.
  --backend in CLI is a debug override; daemon API selects backend by policy and may ignore this hint.
  --storage-state is a legacy/debug/import override and should not be the default path."""


async def run_cli(args: list[str]) -> int:
    try:
        if args[:2] == ['daemon', 'run']:
            from ..daemon.server import start_daemon_server
            await start_daemon_server()
            await asyncio.Future()
            return 0

        if not args or '--help' in args or '-h' in args:
            print(_HELP_TEXT)
            return 0

        if '--version' in args or '-v' in args:
            print('0.1.0')
            return 0

        json_flag = args.count('--json') >= 1
        if not json_flag:
            raise BrowserPlatformError(
                'Only --json output is implemented in this MVP skeleton',
                code='JSON_REQUIRED',
            )

        result = await _dispatch(args)
        print_json(result)
        return 0

    except Exception as exc:
        print_error_json(exc)
        return 1


async def _dispatch(args: list[str]) -> object:
    if args[:2] == ['daemon', 'ensure']:
        return await handle_daemon_ensure()
    if args[:2] == ['daemon', 'status']:
        return await handle_daemon_status()
    if args[:2] == ['session', 'open']:
        return await handle_session_open(args)
    if args[:2] == ['session', 'context']:
        return await handle_session_context(args)
    if args[:2] == ['session', 'observe']:
        return await handle_session_observe(args)
    if args[:2] == ['session', 'act']:
        return await handle_session_act(args)
    if args[:2] == ['session', 'snapshot']:
        return await handle_session_snapshot(args)
    if args[:2] == ['session', 'close']:
        return await handle_session_close(args)

    raise BrowserPlatformError(f"Unknown command: {' '.join(args)}", code='UNKNOWN_COMMAND')
