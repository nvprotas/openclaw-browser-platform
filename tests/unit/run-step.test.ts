import { describe, expect, it } from 'vitest';
import type { SessionActionPayload } from '../../src/daemon/types.js';
import { createEmptyPaymentContext } from '../../src/helpers/payment-context.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';
import { shouldCapturePaymentGatewayUrl, withPaymentHint } from '../../src/runtime/run-step.js';

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
    pageSignatureGuess: 'content_page',
    paymentContext: createEmptyPaymentContext()
  } satisfies PageStateSummary;

  return {
    ...base,
    ...input
  };
}

describe('run-step payment helpers', () => {
  it('adds a captured payecom hint and recomputes terminal payment context', () => {
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527&trace-id=df3fb423-c3c7-44af-88bb-b5871cacb080&method=russian_card&system=sbercard'
    });

    const next = withPaymentHint(state, 'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff');

    expect(next.urlHints).toContain('https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff');
    expect(next.paymentContext).toMatchObject({
      provider: 'sberpay',
      paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      terminalExtractionResult: true
    });
  });

  it('does not duplicate an existing payment hint', () => {
    const hint = 'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff';
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527',
      urlHints: [hint]
    });

    expect(withPaymentHint(state, hint).urlHints).toEqual([hint]);
  });

  it('captures gateway URL only for LitRes checkout payment clicks without an existing payment order id', () => {
    const action = {
      action: 'click',
      selector: '[data-testid="paymentLayout__payment--button"]'
    } satisfies SessionActionPayload;
    const state = buildState({
      url: 'https://www.litres.ru/purchase/ppd/?order=1577454527',
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        phase: 'litres_checkout'
      }
    });

    expect(shouldCapturePaymentGatewayUrl(action, state)).toBe(true);
  });

  it('skips gateway capture outside checkout or after payment order id is known', () => {
    const action = {
      action: 'click',
      text: 'Продолжить'
    } satisfies SessionActionPayload;

    expect(shouldCapturePaymentGatewayUrl(action, buildState({ url: 'https://www.litres.ru/my-books/cart/' }))).toBe(false);
    expect(
      shouldCapturePaymentGatewayUrl(
        action,
        buildState({
          url: 'https://www.litres.ru/purchase/ppd/?order=1577454527',
          paymentContext: {
            ...createEmptyPaymentContext(),
            paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff'
          }
        })
      )
    ).toBe(false);
  });
});
