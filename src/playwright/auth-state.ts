import { access } from 'node:fs/promises';
import type { PageStateSummary } from './browser-session.js';

export type AuthState = 'authenticated' | 'anonymous' | 'login_gate_detected';

export interface AuthStateSummary {
  state: AuthState;
  loginGateDetected: boolean;
  authenticatedSignals: string[];
  anonymousSignals: string[];
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function inferAuthState(url: string, observation: PageStateSummary): AuthStateSummary {
  const joinedTexts = observation.visibleTexts.join(' ').toLowerCase();
  const buttonTexts = observation.visibleButtons
    .map((button) => `${button.text} ${button.ariaLabel ?? ''}`.trim().toLowerCase())
    .join(' ');
  const combined = `${joinedTexts} ${buttonTexts}`;
  const lowerUrl = url.toLowerCase();
  const isIntermediateAuthUrl =
    /id\.sber\.ru/.test(lowerUrl) ||
    /litres\.ru\/auth_proxy\//.test(lowerUrl) ||
    /litres\.ru\/callbacks\/social-auth/.test(lowerUrl);

  const authenticatedSignals = [
    /выйти/.test(combined) ? 'visible_logout' : null,
    /профил/.test(combined) ? 'visible_profile' : null,
    /личный кабинет|мой кабинет/.test(combined) ? 'visible_cabinet' : null,
    /account|profile/.test(lowerUrl) ? 'account_like_url' : null
  ].filter((value): value is string => Boolean(value));

  const anonymousSignals = [
    /войти/.test(combined) ? 'visible_login' : null,
    /sign in|log in/.test(combined) ? 'visible_sign_in' : null
  ].filter((value): value is string => Boolean(value));

  const loginGateDetected =
    observation.pageSignatureGuess === 'auth_form' ||
    isIntermediateAuthUrl ||
    /\/auth\//.test(lowerUrl) ||
    /sberid|login|sign in|log in|войти|пароль/.test(combined);

  if (loginGateDetected) {
    return {
      state: 'login_gate_detected',
      loginGateDetected,
      authenticatedSignals,
      anonymousSignals
    };
  }

  if (authenticatedSignals.length > 0 && !anonymousSignals.includes('visible_login')) {
    return {
      state: 'authenticated',
      loginGateDetected,
      authenticatedSignals,
      anonymousSignals
    };
  }

  return {
    state: 'anonymous',
    loginGateDetected,
    authenticatedSignals,
    anonymousSignals
  };
}
