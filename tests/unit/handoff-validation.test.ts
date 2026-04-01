import { describe, expect, it } from 'vitest';
import { extractPaymentContext } from '../../src/helpers/payment-context.js';
import { buildPostHandoffResumeValidation } from '../../src/helpers/handoff-validation.js';
import { inferAuthState } from '../../src/playwright/auth-state.js';
import type { SessionObservation } from '../../src/daemon/types.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';

function buildObservation(input: Partial<PageStateSummary> & { sessionId?: string; observedAt?: string }): SessionObservation {
  const base = {
    url: 'https://www.litres.ru/',
    title: 'Test',
    readyState: 'complete',
    viewport: { width: 1440, height: 900 },
    visibleTexts: [],
    visibleButtons: [],
    forms: [],
    urlHints: [],
    pageSignatureGuess: 'content_page'
  } satisfies Omit<PageStateSummary, 'paymentContext'>;

  const pageState = {
    ...base,
    ...input
  } as Omit<PageStateSummary, 'paymentContext'>;

  return {
    sessionId: input.sessionId ?? 'session-1',
    observedAt: input.observedAt ?? '2026-04-01T12:00:00.000Z',
    ...pageState,
    paymentContext: extractPaymentContext(pageState)
  };
}

describe('buildPostHandoffResumeValidation', () => {
  it('marks resume as safe when auth is restored and no boundary is visible', () => {
    const observation = buildObservation({
      url: 'https://www.litres.ru/account',
      title: 'Account',
      visibleTexts: ['Профиль', 'Мои книги', 'Выйти'],
      visibleButtons: [{ text: 'Выйти', role: 'button', type: null, ariaLabel: null }],
      pageSignatureGuess: 'content_page'
    });
    const authState = inferAuthState(observation.url, observation);

    const validation = buildPostHandoffResumeValidation(observation, authState);

    expect(validation).toMatchObject({
      observedAt: observation.observedAt,
      url: observation.url,
      title: observation.title,
      pageSignatureGuess: observation.pageSignatureGuess,
      authState: 'authenticated',
      loginGateDetected: false,
      paymentBoundaryVisible: false,
      shouldReportPaymentJson: false,
      safeToProceed: true
    });
    expect(validation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AUTH_RESTORED', ok: true }),
        expect.objectContaining({ code: 'LOGIN_GATE_STILL_VISIBLE', ok: true }),
        expect.objectContaining({ code: 'PAYMENT_BOUNDARY_STILL_ACTIVE', ok: true }),
        expect.objectContaining({ code: 'PAYMENT_JSON_REPORT_REQUIRED', ok: true })
      ])
    );
  });

  it('blocks resume when login gate and payment boundary are still visible', () => {
    const observation = buildObservation({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      title: 'Платёжная страница',
      visibleTexts: ['Войти по Сбер ID', 'Оплатить'],
      visibleButtons: [{ text: 'Оплатить', role: 'button', type: null, ariaLabel: null }],
      urlHints: ['https://id.sber.ru/CSAFront/oidc/authorize.do?redirect_uri=https%3A%2F%2Fpayecom.ru%2Fsberid']
    });
    const authState = inferAuthState(observation.url, observation);

    const validation = buildPostHandoffResumeValidation(observation, authState);

    expect(validation).toMatchObject({
      authState: 'login_gate_detected',
      loginGateDetected: true,
      paymentBoundaryVisible: true,
      shouldReportPaymentJson: true,
      safeToProceed: false
    });
    expect(validation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'AUTH_RESTORED', ok: false }),
        expect.objectContaining({ code: 'LOGIN_GATE_STILL_VISIBLE', ok: false }),
        expect.objectContaining({ code: 'PAYMENT_BOUNDARY_STILL_ACTIVE', ok: false }),
        expect.objectContaining({ code: 'PAYMENT_JSON_REPORT_REQUIRED', ok: false })
      ])
    );
  });
});
