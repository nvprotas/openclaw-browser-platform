import type { PageStateSummary } from '../playwright/browser-session.js';
import { inferAuthState, type AuthStateSummary } from '../playwright/auth-state.js';

export function detectLoginGate(url: string, observation: PageStateSummary): AuthStateSummary {
  return inferAuthState(url, observation);
}
