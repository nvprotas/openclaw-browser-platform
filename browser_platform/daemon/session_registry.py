from __future__ import annotations
import uuid
from datetime import datetime, timezone
from ..helpers.payment_context import create_empty_payment_context

DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60_000


def _iso_now(now_ms: float | None = None) -> str:
    if now_ms is not None:
        return datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


class SessionRegistry:
    def __init__(self, *, default_idle_timeout_ms: int | None = None, now=None) -> None:
        self._default_idle_timeout_ms = default_idle_timeout_ms or DEFAULT_SESSION_IDLE_TIMEOUT_MS
        self._now = now
        self._sessions: dict[str, dict] = {}

    def _now_ms(self) -> float:
        if self._now:
            return self._now()
        import time
        return time.time() * 1000

    def _now_iso(self) -> str:
        return _iso_now(self._now_ms())

    def open(self, *, url: str, backend: str, title: str | None = None,
             scenario_id: str | None = None, profile_context: dict | None = None,
             idle_timeout_ms: int | None = None) -> dict:
        now = self._now_iso()
        session: dict = {
            'sessionId': str(uuid.uuid4()),
            'backend': backend,
            'url': url,
            'title': title,
            'createdAt': now,
            'updatedAt': now,
            'lastUsedAt': now,
            'idleTimeoutMs': idle_timeout_ms if idle_timeout_ms is not None else self._default_idle_timeout_ms,
            'status': 'open',
            'closeReason': None,
            'closedAt': None,
            'scenarioContext': {
                'scenarioId': scenario_id,
                'reusePolicy': 'open_fresh_session',
            },
            'profileContext': profile_context or {
                'profileId': None,
                'persistent': False,
                'source': None,
                'storageStatePath': None,
                'storageStateExists': False,
            },
            'packContext': {
                'matchedPack': False,
                'siteId': None,
                'supportLevel': None,
                'matchedDomain': None,
                'startUrl': None,
                'flows': [],
                'knownRisks': [],
                'instructionsSummary': [],
                'knownSignals': [],
            },
            'authContext': {
                'state': 'anonymous',
                'loginGateDetected': False,
                'bootstrapAttempted': False,
                'bootstrapSource': None,
                'storageStatePath': None,
                'storageStateExists': False,
                'authenticatedSignals': [],
                'anonymousSignals': [],
                'handoffRequired': False,
                'bootstrapFailed': False,
                'redirectedToSberId': False,
                'bootstrapStatus': 'not_attempted',
                'bootstrapScriptPath': None,
                'bootstrapOutDir': None,
                'bootstrapFinalUrl': None,
                'bootstrapError': None,
                'bootstrapDurationMs': None,
                'bootstrapTimeline': [],
            },
            'paymentContext': create_empty_payment_context(),
        }
        self._sessions[session['sessionId']] = session
        return session

    def get(self, session_id: str) -> dict | None:
        return self._sessions.get(session_id)

    def touch(self, session_id: str, patch: dict) -> dict | None:
        existing = self._sessions.get(session_id)
        if existing is None:
            return None
        updated = {**existing, **patch, 'updatedAt': self._now_iso()}
        self._sessions[session_id] = updated
        return updated

    def touch_usage(self, session_id: str, patch: dict | None = None) -> dict | None:
        existing = self._sessions.get(session_id)
        if existing is None:
            return None
        now = self._now_iso()
        updated = {**existing, **(patch or {}), 'updatedAt': now, 'lastUsedAt': now}
        self._sessions[session_id] = updated
        return updated

    def close(self, session_id: str, reason: str = 'manual') -> dict | None:
        return self.touch(session_id, {
            'status': 'closed',
            'closeReason': reason,
            'closedAt': self._now_iso(),
        })

    def remove(self, session_id: str) -> dict | None:
        return self._sessions.pop(session_id, None)

    def find_expired_session_ids(self, now_ms: float | None = None) -> list[str]:
        now = now_ms if now_ms is not None else self._now_ms()
        result = []
        for session in self._sessions.values():
            if session['status'] != 'open':
                continue
            try:
                last_used_ms = datetime.fromisoformat(session['lastUsedAt']).timestamp() * 1000
            except (ValueError, TypeError):
                continue
            if now - last_used_ms >= session['idleTimeoutMs']:
                result.append(session['sessionId'])
        return result

    def close_all(self, reason: str = 'shutdown') -> list[dict]:
        result = []
        for session_id in list(self._sessions.keys()):
            closed = self.close(session_id, reason)
            if closed:
                result.append(closed)
        return result

    def clear(self) -> None:
        self._sessions.clear()

    def count_open(self) -> int:
        return sum(1 for s in self._sessions.values() if s['status'] == 'open')
