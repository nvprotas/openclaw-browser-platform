from __future__ import annotations
import asyncio
import time
from pathlib import Path

from ..core.errors import BrowserPlatformError
from ..traces.writer import TraceWriter
from ..debug.capture import (
    is_debug_enabled,
    capture_debug_step,
    capture_debug_step_json,
    append_debug_log,
)
from .browser_session import BrowserContextPool, BrowserSession


class PlaywrightController:
    def __init__(self, root_dir: str) -> None:
        self._root_dir = root_dir
        self._sessions: dict[str, BrowserSession] = {}
        self._session_locks: dict[str, asyncio.Lock] = {}
        self._trace_writer = TraceWriter(
            str(Path(root_dir) / 'artifacts' / 'traces')
        )
        self._context_pool = BrowserContextPool()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def open_session(
        self,
        session_id: str,
        url: str,
        *,
        storage_state_path: str | None = None,
        backend: str | None = None,
    ) -> dict:
        session = BrowserSession(
            session_id=session_id,
            snapshot_root_dir=str(Path(self._root_dir) / 'artifacts' / 'snapshots'),
            storage_state_path=storage_state_path,
            backend=backend,
            context_pool=self._context_pool if storage_state_path else None,
        )
        opened = await session.open(url)
        session.mark_used()
        self._sessions[session_id] = session
        await self._debug_capture(session_id, 'open', {
            'sessionId': session_id,
            'url': opened['url'],
            'title': opened['title'],
        })
        return opened

    async def observe_session(self, session_id: str) -> dict:
        async def _op():
            session = self._require_session(session_id)
            session.mark_used()
            result = await session.observe()
            await self._debug_capture(session_id, 'observe', {
                'sessionId': session_id,
                'url': result['url'],
                'title': result['title'],
            })
            return result

        return await self._run_exclusive(session_id, 'observe', _op)

    async def adopt_session(
        self,
        session_id: str,
        adopted: dict,
        *,
        storage_state_path: str | None = None,
        backend: str | None = None,
    ) -> dict:
        async def _op():
            await self._close_session_unlocked(session_id)

            session = BrowserSession(
                session_id=session_id,
                snapshot_root_dir=str(Path(self._root_dir) / 'artifacts' / 'snapshots'),
                storage_state_path=storage_state_path,
                backend=backend,
            )
            try:
                session.adopt_existing(adopted)
                session.mark_used()
                await session.persist_storage_state()
                page = session.page()
                self._sessions[session_id] = session
                return {
                    'url': page.url,
                    'title': await page.title(),
                }
            except Exception:
                await session.close()
                raise

        return await self._run_exclusive(session_id, 'adopt', _op)

    async def write_trace(self, session_id: str, step_type: str, payload: object) -> dict:
        return self._trace_writer.write_step(session_id, step_type, payload)

    async def act_in_session(self, session_id: str, payload: dict) -> dict:
        async def _op():
            from ..runtime.run_step import run_step, build_action_result
            session = self._require_session(session_id)
            session.mark_used()
            before, after, observations = await run_step(session, payload)
            await session.persist_storage_state()
            result = build_action_result(payload, before, after, observations)
            await self._debug_capture(session_id, f"act-{payload.get('action')}", {
                'sessionId': session_id,
                'action': result.get('action'),
                'target': result.get('target'),
                'input': result.get('input'),
                'before': {'url': before['url'], 'title': before['title']},
                'after': {'url': after['url'], 'title': after['title']},
                'changes': result.get('changes'),
            })
            return result

        return await self._run_exclusive(session_id, 'act', _op)

    async def snapshot_session(self, session_id: str) -> dict:
        async def _op():
            session = self._require_session(session_id)
            session.mark_used()
            result = await session.snapshot()
            if is_debug_enabled():
                await capture_debug_step_json(
                    self._root_dir, session_id, 'snapshot', {
                        'sessionId': session_id,
                        'screenshotPath': result['screenshotPath'],
                        'htmlPath': result['htmlPath'],
                        'url': result['state']['url'],
                        'title': result['state']['title'],
                    }
                )
            return result

        return await self._run_exclusive(session_id, 'snapshot', _op)

    async def close_session(self, session_id: str) -> None:
        async def _op():
            await self._close_session_unlocked(session_id)

        await self._run_exclusive(session_id, 'close', _op)

    def has_session(self, session_id: str) -> bool:
        return session_id in self._sessions

    async def close_all(self) -> None:
        session_ids = list(self._sessions.keys())
        await asyncio.gather(*(self.close_session(sid) for sid in session_ids))
        await self._context_pool.close_all()

    def get_session_page(self, session_id: str):
        session = self._sessions.get(session_id)
        if session is None:
            return None
        try:
            return session.page()
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _close_session_unlocked(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is not None:
            await session.close()

    async def _run_exclusive(self, session_id: str, op_name: str, fn) -> object:
        lock = self._session_locks.setdefault(session_id, asyncio.Lock())
        queued_at_ms = time.time() * 1000
        queued_at = _iso_now()
        async with lock:
            started_at_ms = time.time() * 1000
            started_at = _iso_now()
            status = 'ok'
            try:
                return await fn()
            except Exception:
                status = 'error'
                raise
            finally:
                finished_at_ms = time.time() * 1000
                if is_debug_enabled():
                    asyncio.ensure_future(append_debug_log(self._root_dir, {
                        'source': 'browser',
                        'event': 'session-operation',
                        'sessionId': session_id,
                        'opName': op_name,
                        'status': status,
                        'queuedAt': queued_at,
                        'startedAt': started_at,
                        'finishedAt': _iso_now(),
                        'waitedMs': started_at_ms - queued_at_ms,
                        'runMs': finished_at_ms - started_at_ms,
                    }))

    async def _debug_capture(self, session_id: str, step_name: str, meta: dict) -> None:
        if not is_debug_enabled():
            return
        start_ms = time.time() * 1000
        page = self.get_session_page(session_id)
        if page is None:
            return
        await capture_debug_step(page, self._root_dir, session_id, step_name, meta)
        await append_debug_log(self._root_dir, {
            'source': 'browser',
            'event': step_name,
            'sessionId': session_id,
            'durationMs': time.time() * 1000 - start_ms,
            **meta,
        })

    def _require_session(self, session_id: str) -> BrowserSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise BrowserPlatformError('Session not found', code='SESSION_NOT_FOUND')
        return session


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
