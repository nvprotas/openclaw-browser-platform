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

describe('hard-stop signal', () => {
  it('emits hard stop for payecom gateway with extraction payload', () => {
    const state = buildState({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      visibleTexts: ['Войти по Сбер ID']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    expect(hardStop).toMatchObject({
      enabled: true,
      terminalMode: true,
      reason: 'terminal_extraction_result',
      returnPolicy: 'return_final_payload_verbatim',
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
      terminalMode: true,
      reason: 'terminal_extraction_result',
      returnPolicy: 'return_final_payload_verbatim',
      gateway: 'platiecom'
    });
    expect(hardStop?.finalPayload.mdOrder).toBe('md-456');
  });

  it('emits hard stop even without gateway URL when terminalExtractionResult is true and extractionJson is present', () => {
    // litres checkout page with formUrl hint pointing to payecom, but pay_ru (not matched by gateway regex)
    // Previously this returned null — now it must return a hardstop
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      urlHints: ['https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    // urlHints contains a valid payecom gateway URL — should resolve gateway
    expect(hardStop).not.toBeNull();
    expect(hardStop?.terminalMode).toBe(true);
    expect(hardStop?.finalPayload).toBeDefined();
  });

  it('does not emit hard stop when no extractionJson is present', () => {
    // plain litres page without any payment identifiers
    const state = buildState({
      url: 'https://www.litres.ru/',
      visibleTexts: ['Купить']
    });

    const hardStop = buildHardStopSignal(state.url, state.paymentContext);

    expect(hardStop).toBeNull();
  });

  it('adds HARD_STOP_TERMINAL_EXTRACTION_RESULT observation so caller does not continue normal flow', () => {
    const before = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: ['Российская карта', 'Продолжить']
    });
    const after = buildState({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      visibleTexts: ['Войти по Сбер ID']
    });

    const observations = buildPostActionObservations(before, after);
    const hardStopObservation = observations.find((item) => item.code === 'HARD_STOP_TERMINAL_EXTRACTION_RESULT');

    expect(hardStopObservation).toBeTruthy();
    expect(hardStopObservation?.level).toBe('warning');
    expect(hardStopObservation?.message).toContain('do not continue normal flow');
  });

  it('PAYMENT_IDS_DETECTED observation is warning level when terminalExtractionResult fires', () => {
    const before = buildState({
      url: 'https://www.litres.ru/cart/',
      visibleTexts: ['Корзина']
    });
    const after = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      urlHints: ['https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff']
    });

    const observations = buildPostActionObservations(before, after);
    const detected = observations.find((item) => item.code === 'PAYMENT_IDS_DETECTED');

    expect(detected).toBeTruthy();
    expect(detected?.level).toBe('warning');
    expect(detected?.message).toContain('СТОП');
  });
});
