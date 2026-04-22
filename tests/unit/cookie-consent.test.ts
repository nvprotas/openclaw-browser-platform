import { describe, expect, it, vi } from 'vitest';
import {
  acceptCookieConsent,
  buildCookieConsentObservation,
  shouldAttemptCookieConsent
} from '../../src/helpers/consent.js';

describe('cookie consent helper', () => {
  it('detects visible accept buttons from observation summaries', () => {
    expect(
      shouldAttemptCookieConsent({
        visibleButtons: [
          { text: 'Принять', role: 'button', type: 'button', ariaLabel: null }
        ]
      })
    ).toBe(true);

    expect(
      shouldAttemptCookieConsent({
        visibleButtons: [
          { text: 'Купить', role: 'button', type: 'button', ariaLabel: null }
        ]
      })
    ).toBe(false);
  });

  it('returns an action observation after accepting consent', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        status: 'accepted',
        selector: "button:has-text('Принять')",
        text: 'Принять'
      })),
      waitForLoadState: vi.fn(async () => undefined)
    };

    const result = await acceptCookieConsent({
      page: vi.fn(() => page)
    } as never);

    expect(result).toMatchObject({ status: 'accepted', text: 'Принять' });
    expect(buildCookieConsentObservation(result)).toMatchObject({
      level: 'info',
      code: 'COOKIE_CONSENT_ACCEPTED'
    });
  });
});
