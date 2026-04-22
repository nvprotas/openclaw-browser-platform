from __future__ import annotations
import os
import re
from pathlib import Path


def file_exists(path: str) -> bool:
    return Path(path).exists()


def infer_auth_state(url: str, observation: dict) -> dict:
    joined_texts = ' '.join(observation.get('visibleTexts', [])).lower()
    button_texts = ' '.join(
        f'{btn.get("text", "")} {btn.get("ariaLabel", "") or ""}'.strip().lower()
        for btn in observation.get('visibleButtons', [])
    )
    combined = f'{joined_texts} {button_texts}'
    lower_url = url.lower()

    is_intermediate_auth_url = (
        re.search(r'id\.sber\.ru', lower_url) is not None
        or re.search(r'litres\.ru/auth_proxy/', lower_url) is not None
        or re.search(r'litres\.ru/callbacks/social-auth', lower_url) is not None
    )

    authenticated_signals = []
    if re.search(r'выйти', combined):
        authenticated_signals.append('visible_logout')
    if re.search(r'профил', combined):
        authenticated_signals.append('visible_profile')
    if re.search(r'личный кабинет|мой кабинет', combined):
        authenticated_signals.append('visible_cabinet')
    if re.search(r'account|profile', lower_url):
        authenticated_signals.append('account_like_url')

    anonymous_signals = []
    if re.search(r'войти', combined):
        anonymous_signals.append('visible_login')
    if re.search(r'sign in|log in', combined):
        anonymous_signals.append('visible_sign_in')

    login_gate_detected = (
        observation.get('pageSignatureGuess') == 'auth_form'
        or is_intermediate_auth_url
        or re.search(r'/auth/', lower_url) is not None
        or re.search(r'sberid|login|sign in|log in|войти|пароль', combined) is not None
    )

    if login_gate_detected:
        state = 'login_gate_detected'
    elif authenticated_signals and 'visible_login' not in anonymous_signals:
        state = 'authenticated'
    else:
        state = 'anonymous'

    return {
        'state': state,
        'loginGateDetected': login_gate_detected,
        'authenticatedSignals': authenticated_signals,
        'anonymousSignals': anonymous_signals,
    }
