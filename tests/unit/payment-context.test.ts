import { describe, expect, it } from 'vitest';
import { extractPaymentContext } from '../../src/helpers/payment-context.js';
import { summarizeObservation } from '../../src/helpers/tracing.js';
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

describe('payment context extraction', () => {
  it('extracts LitRes checkout ids and payecom order id from iframe hint', () => {
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: ['Назад', 'Оплата российской картой', 'Отсутствует подключение к Интернету'],
      urlHints: ['https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff']
    });

    expect(state.paymentContext).toMatchObject({
      detected: true,
      shouldReportImmediately: true,
      phase: 'litres_checkout',
      paymentMethod: 'russian_card',
      paymentSystem: 'sbercard',
      paymentUrl: 'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      litresOrder: '1577454527',
      traceId: 'df3fb423-c3c7-44af-88bb-b5871cacb080',
      extractionJson: {
        paymentMethod: 'SberPay',
        paymentUrl: 'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
        paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
        source: 'url'
      }
    });
  });


  it('extracts nested payment identifiers from encoded handoff hints without manual snapshot html', () => {
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: [
        'Оплата российской картой',
        'href=https%3A%2F%2Fid.sber.ru%2FCSAFront%2Foidc%2Fauthorize.do%3Fredirect_uri%3Dhttps%253A%252F%252Fpayecom.ru%252Fsberid',
        'formUrl=https%3A%2F%2Fpayecom.ru%2Fpay%3ForderId%3D019d44bf-26ad-5eb3-13d1-e41086dc9cff',
        'bankInvoiceId=bank-123 mdOrder=md-456 merchantOrderId=merchant-id merchantOrderNumber=merchant-number'
      ],
      urlHints: [
        'https://platiecom.ru/deeplink?params=bankInvoiceId%3Dbank-123%26mdOrder%3Dmd-456%26merchantOrderId%3Dmerchant-id%26merchantOrderNumber%3Dmerchant-number%26formUrl%3Dhttps%253A%252F%252Fpayecom.ru%252Fpay%253ForderId%253D019d44bf-26ad-5eb3-13d1-e41086dc9cff%26href%3Dhttps%253A%252F%252Fid.sber.ru%252FCSAFront%252Foidc%252Fauthorize.do%253Fredirect_uri%253Dhttps%25253A%25252F%25252Fpayecom.ru%25252Fsberid'
      ]
    });

    expect(state.paymentContext).toMatchObject({
      detected: true,
      shouldReportImmediately: true,
      phase: 'platiecom_deeplink',
      provider: 'sberpay',
      paymentUrl: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      bankInvoiceId: 'bank-123',
      mdOrder: 'md-456',
      merchantOrderId: 'merchant-id',
      merchantOrderNumber: 'merchant-number',
      formUrl: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff'
    });
    expect(state.paymentContext.href).toContain('id.sber.ru/CSAFront/oidc/authorize.do');
    expect(state.paymentContext.extractionJson).toMatchObject({
      source: 'deeplink',
      bankInvoiceId: 'bank-123',
      mdOrder: 'md-456',
      merchantOrderId: 'merchant-id',
      merchantOrderNumber: 'merchant-number'
    });
  });

  it('detects payecom sberpay boundary and sber id handoff', () => {
    const state = buildState({
      url: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      title: 'Платёжная страница',
      visibleTexts: ['Войти по Сбер ID', 'Оплатить'],
      visibleButtons: [{ text: 'Оплатить', role: 'button', type: null, ariaLabel: null }],
      urlHints: [
        'https://id.sber.ru/CSAFront/oidc/authorize.do?redirect_uri=https%3A%2F%2Fpayecom.ru%2Fsberid&state=7f551e22173a4c979988aba5703059d8'
      ]
    });

    expect(state.paymentContext).toMatchObject({
      detected: true,
      shouldReportImmediately: true,
      provider: 'sberpay',
      phase: 'payecom_boundary',
      paymentUrl: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      extractionJson: {
        paymentMethod: 'SberPay',
        paymentUrl: 'https://payecom.ru/pay?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff',
        paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
        source: 'url'
      }
    });
    expect(state.paymentContext.href).toContain('id.sber.ru/CSAFront/oidc/authorize.do');

    const summaryCodes = summarizeObservation(state).map((item) => item.code);
    expect(summaryCodes).toContain('PAYMENT_BOUNDARY_VISIBLE');
    expect(summaryCodes).toContain('SBERPAY_ENTRY_VISIBLE');
    expect(summaryCodes).toContain('SBER_ID_HANDOFF_VISIBLE');
    expect(summaryCodes).toContain('PAYMENT_BOUNDARY_CARD_FORM_VISIBLE');
  });
});

describe('payment observations', () => {
  it('tells the caller to report payment ids before continuing when they first appear', () => {
    const before = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: ['Оформление покупки', 'Российская карта', 'Продолжить']
    });
    const after = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard&from=cart',
      visibleTexts: ['Оплата российской картой', 'Отсутствует подключение к Интернету'],
      urlHints: ['https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff']
    });

    const observations = buildPostActionObservations(before, after);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PAYMENT_IDS_DETECTED'
        })
      ])
    );
    const paymentObservation = observations.find((item) => item.code === 'PAYMENT_IDS_DETECTED');
    expect(paymentObservation?.message).toContain('Return paymentContext.extractionJson as JSON before continuing');
    expect(paymentObservation?.message).toContain('"paymentOrderId":"019d44bf-26ad-5eb3-13d1-e41086dc9cff"');
  });
});
