from __future__ import annotations
from typing import Any, Literal

SESSION_BACKENDS: tuple[str, ...] = ('camoufox', 'chromium')
SessionBackend = Literal['camoufox', 'chromium']


TimingEntry = dict[str, Any]


class SessionPackContext(dict):
    pass


class SessionAuthContext(dict):
    pass


class SessionProfileContext(dict):
    pass


class SessionScenarioContext(dict):
    pass


class PaymentIntentSummary(dict):
    pass


class SberPayExtractionJson(dict):
    pass


class SessionPaymentContext(dict):
    pass


class SessionRecord(dict):
    pass


class HardStopSignal(dict):
    pass


class SessionObservation(dict):
    pass


class SessionSnapshot(dict):
    pass


class ActionObservationSummary(dict):
    pass


class ActionDiffSummary(dict):
    pass


class SessionActionResult(dict):
    pass


class DaemonInfo(dict):
    pass


class DaemonStatusResponse(dict):
    pass


class SessionOpenResponse(dict):
    pass


class SessionContextResponse(dict):
    pass


class SessionCloseResponse(dict):
    pass


class SessionObserveResponse(dict):
    pass


class SessionSnapshotResponse(dict):
    pass


class SessionActResponse(dict):
    pass
