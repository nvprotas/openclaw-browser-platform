from __future__ import annotations
from ..playwright.auth_state import infer_auth_state


def detect_login_gate(url: str, observation: dict) -> dict:
    return infer_auth_state(url, observation)
