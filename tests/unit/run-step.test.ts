import { describe, expect, it, vi } from 'vitest';
import type { SessionActionPayload } from '../../src/daemon/types.js';
import { createEmptyPaymentContext } from '../../src/helpers/payment-context.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';
import {
  buildActionResult,
  runStep,
  shouldCapturePaymentGatewayUrl,
  withPaymentHint
} from '../../src/runtime/run-step.js';

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

    const next = withPaymentHint(
      state,
      'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff'
    );

    expect(next.urlHints).toContain(
      'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff'
    );
    expect(next.paymentContext).toMatchObject({
      provider: 'sberpay',
      paymentOrderId: '019d44bf-26ad-5eb3-13d1-e41086dc9cff',
      terminalExtractionResult: true
    });
  });

  it('does not duplicate an existing payment hint', () => {
    const hint =
      'https://payecom.ru/pay_ru?orderId=019d44bf-26ad-5eb3-13d1-e41086dc9cff';
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

    expect(
      shouldCapturePaymentGatewayUrl(
        action,
        buildState({ url: 'https://www.litres.ru/my-books/cart/' })
      )
    ).toBe(false);
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

  it('adds FAILED_CART_NAVIGATION to cart-target actions that land on a 404-like page', () => {
    const before = buildState({
      url: 'https://brandshop.ru/goods/1/',
      pageSignatureGuess: 'product_page'
    });
    const after = buildState({
      url: 'https://brandshop.ru/cart/',
      title: '404',
      visibleTexts: ['Страница не найдена'],
      pageSignatureGuess: 'unknown'
    });

    const result = buildActionResult(
      { action: 'click', selector: "a[href*='cart']" },
      before,
      after
    );

    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FAILED_CART_NAVIGATION' })
      ])
    );
  });
});

describe('run-step modal dismissal', () => {
  it('dismisses a blocking modal and retries the original click', async () => {
    const before = buildState({ url: 'https://www.litres.ru/book/test/' });
    const after = buildState({
      url: 'https://www.litres.ru/book/test/',
      visibleTexts: ['Добавлено в корзину']
    });
    const click = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('locator.click: Timeout 5000ms exceeded')
      )
      .mockResolvedValueOnce(undefined);
    const locator = {
      click,
      boundingBox: vi.fn(async () => ({
        x: 10,
        y: 20,
        width: 100,
        height: 40
      })),
      page: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({
        first: vi.fn(() => locator)
      })),
      url: vi.fn(() => 'https://www.litres.ru/book/test/'),
      waitForURL: vi
        .fn()
        .mockRejectedValue(new Error('Timeout 1500ms exceeded')),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce('div[data-testid="modal--wrapper"]')
        .mockResolvedValueOnce({
          status: 'dismissed',
          reason: 'dismissed by safe modal control',
          selector: '[data-testid="modal--close-button"]',
          text: 'Закрыть',
          blocker: 'div[data-testid="modal--wrapper"]'
        }),
      waitForLoadState: vi.fn(async () => undefined)
    };
    locator.page.mockReturnValue(page);

    const session = {
      observe: vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      page: vi.fn(() => page),
      waitForInitialLoad: vi.fn()
    };

    const result = await runStep(session as never, {
      action: 'click',
      selector: '#buy'
    });

    expect(click).toHaveBeenCalledTimes(2);
    expect(result.after.visibleTexts).toContain('Добавлено в корзину');
    expect(result.observations.map((observation) => observation.code)).toEqual(
      expect.arrayContaining([
        'BLOCKING_MODAL_DETECTED',
        'BLOCKING_MODAL_DISMISSED',
        'CLICK_RETRIED_AFTER_MODAL_DISMISS'
      ])
    );
  });

  it('keeps clean clicks on the fast path without modal observations', async () => {
    const before = buildState({ url: 'https://www.litres.ru/book/test/' });
    const after = buildState({ url: 'https://www.litres.ru/book/test/' });
    const locator = {
      click: vi.fn(async () => undefined),
      boundingBox: vi.fn(),
      page: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({
        first: vi.fn(() => locator)
      })),
      url: vi.fn(() => 'https://www.litres.ru/book/test/'),
      waitForURL: vi
        .fn()
        .mockRejectedValue(new Error('Timeout 1500ms exceeded')),
      evaluate: vi.fn(),
      waitForLoadState: vi.fn(async () => undefined)
    };
    locator.page.mockReturnValue(page);

    const result = await runStep(
      {
        observe: vi
          .fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(after),
        page: vi.fn(() => page),
        waitForInitialLoad: vi.fn()
      } as never,
      { action: 'click', selector: '#buy' }
    );

    expect(locator.click).toHaveBeenCalledTimes(1);
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(result.observations).toEqual([]);
  });

  it('does not dismiss or retry authentication gates', async () => {
    const clickError = new Error('locator.click: Timeout 5000ms exceeded');
    const locator = {
      click: vi.fn().mockRejectedValue(clickError),
      boundingBox: vi.fn(async () => ({
        x: 10,
        y: 20,
        width: 100,
        height: 40
      })),
      page: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({
        first: vi.fn(() => locator)
      })),
      url: vi.fn(() => 'https://www.litres.ru/book/test/'),
      waitForURL: vi
        .fn()
        .mockRejectedValue(new Error('Timeout 1500ms exceeded')),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce('div[data-testid="modal--wrapper"]')
        .mockResolvedValueOnce({
          status: 'not_dismissible',
          reason: 'Blocking modal looks like an authentication gate.',
          selector: '[data-testid="modal--wrapper"]',
          text: 'Войти Номер телефона Продолжить',
          blocker: 'div[data-testid="modal--wrapper"]'
        }),
      waitForLoadState: vi.fn(async () => undefined)
    };
    locator.page.mockReturnValue(page);

    await expect(
      runStep(
        {
          observe: vi.fn().mockResolvedValue(buildState({})),
          page: vi.fn(() => page),
          waitForInitialLoad: vi.fn()
        } as never,
        { action: 'click', selector: '#buy' }
      )
    ).rejects.toThrow(clickError.message);

    expect(locator.click).toHaveBeenCalledTimes(1);
    expect(page.waitForLoadState).not.toHaveBeenCalled();
  });

  it('stops after the modal dismiss retry budget is exhausted', async () => {
    const clickError = new Error('locator.click: Timeout 5000ms exceeded');
    const locator = {
      click: vi.fn().mockRejectedValue(clickError),
      boundingBox: vi.fn(async () => ({
        x: 10,
        y: 20,
        width: 100,
        height: 40
      })),
      page: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({
        first: vi.fn(() => locator)
      })),
      url: vi.fn(() => 'https://www.litres.ru/book/test/'),
      waitForURL: vi
        .fn()
        .mockRejectedValue(new Error('Timeout 1500ms exceeded')),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce('div[data-testid="modal--wrapper"]')
        .mockResolvedValueOnce({
          status: 'dismissed',
          reason: 'dismissed by safe modal control',
          selector: '[data-testid="modal--close-button"]',
          text: 'Закрыть',
          blocker: 'div[data-testid="modal--wrapper"]'
        })
        .mockResolvedValueOnce('div[data-testid="modal--wrapper"]')
        .mockResolvedValueOnce({
          status: 'dismissed',
          reason: 'dismissed by safe modal control',
          selector: '[data-testid="modal--close-button"]',
          text: 'Закрыть',
          blocker: 'div[data-testid="modal--wrapper"]'
        }),
      waitForLoadState: vi.fn(async () => undefined)
    };
    locator.page.mockReturnValue(page);

    await expect(
      runStep(
        {
          observe: vi.fn().mockResolvedValue(buildState({})),
          page: vi.fn(() => page),
          waitForInitialLoad: vi.fn()
        } as never,
        { action: 'click', selector: '#buy' }
      )
    ).rejects.toThrow(clickError.message);

    expect(locator.click).toHaveBeenCalledTimes(3);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('falls back to a generic blocker message when the click point cannot be described', async () => {
    const before = buildState({});
    const after = buildState({ visibleTexts: ['Добавлено в корзину'] });
    const locator = {
      click: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('locator.click: Timeout 5000ms exceeded')
        )
        .mockResolvedValueOnce(undefined),
      boundingBox: vi.fn(async () => null),
      page: vi.fn()
    };
    const page = {
      locator: vi.fn(() => ({
        first: vi.fn(() => locator)
      })),
      url: vi.fn(() => 'https://www.litres.ru/book/test/'),
      waitForURL: vi
        .fn()
        .mockRejectedValue(new Error('Timeout 1500ms exceeded')),
      evaluate: vi.fn().mockResolvedValueOnce({
        status: 'dismissed',
        reason: 'dismissed by safe modal control',
        selector: null,
        text: 'ПРИНЯТЬ',
        blocker: null
      }),
      waitForLoadState: vi.fn(async () => undefined)
    };
    locator.page.mockReturnValue(page);

    const result = await runStep(
      {
        observe: vi
          .fn()
          .mockResolvedValueOnce(before)
          .mockResolvedValueOnce(after),
        page: vi.fn(() => page),
        waitForInitialLoad: vi.fn()
      } as never,
      { action: 'click', selector: '#buy' }
    );

    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'BLOCKING_MODAL_DETECTED',
          message: 'Click target was blocked by a modal.'
        })
      ])
    );
  });
});
