import { describe, expect, it } from 'vitest';
import { buildHardStopSignal } from '../../src/helpers/hard-stop.js';
import { extractPaymentContext } from '../../src/helpers/payment-context.js';
import { buildPostActionObservations } from '../../src/helpers/validation.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';

function buildState(input: Partial<PageStateSummary>): PageStateSummary {
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

  const merged = {
    ...base,
    ...input
  } as Omit<PageStateSummary, 'paymentContext'>;

  return {
    ...merged,
    paymentContext: extractPaymentContext(merged)
  };
}

describe('gateway hard-stop signal', () => {
  it('emits hard stop for payecom gateway with extraction payload', () => {
    const state = buildState({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      visibleTexts: ['Войти по Сбер ID']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    expect(hardStop).toMatchObject({
      enabled: true,
      reason: 'gateway_payment_json_ready',
      gateway: 'payecom',
      gatewayUrl: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      finalPayload: {
        paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff'
      }
    });
  });

  it('emits hard stop for platiecom deeplink gateway with extraction payload', () => {
    const state = buildState({
      url: 'https://platiecom.ru/deeplink?params=bankInvoiceId%3Dbank-123%26mdOrder%3Dmd-456%26formUrl%3Dhttps%253A%252F%252Fpayecom.ru%252Fpay%253ForderId%253D019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      visibleTexts: ['Оплата']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    expect(hardStop).toMatchObject({
      enabled: true,
      reason: 'gateway_payment_json_ready',
      gateway: 'platiecom'
    });
    expect(hardStop?.finalPayload.mdOrder).toBe('md-456');
  });

  it('does not emit hard stop for non-gateway checkout URL', () => {
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      urlHints: ['https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    expect(hardStop).toBeNull();
  });

  it('adds explicit hard-stop observation so caller does not continue normal flow', () => {
    const before = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: ['Российская карта', 'Продолжить']
    });
    const after = buildState({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      visibleTexts: ['Войти по Сбер ID']
    });

    const observations = buildPostActionObservations(before, after);
    const hardStopObservation = observations.find((item) => item.code === 'HARD_STOP_GATEWAY_PAYMENT_JSON_READY');

    expect(hardStopObservation).toBeTruthy();
    expect(hardStopObservation?.message).toContain('do not continue normal flow');
  });
});
