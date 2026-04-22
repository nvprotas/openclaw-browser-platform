import { describe, expect, it, vi } from 'vitest';
import type { ScenarioActionResult } from '../../src/runtime/scenarios/litres-checkout.js';
import { runLitresCheckoutScenario } from '../../src/runtime/scenarios/litres-checkout.js';
import { createEmptyPaymentContext } from '../../src/helpers/payment-context.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';

function state(input: Partial<PageStateSummary>): PageStateSummary {
  return {
    url: 'https://www.litres.ru/',
    title: 'LitRes',
    readyState: 'complete',
    viewport: { width: 1440, height: 900 },
    visibleTexts: [],
    visibleButtons: [],
    forms: [],
    urlHints: [],
    pageSignatureGuess: 'content_page',
    paymentContext: createEmptyPaymentContext(),
    ...input
  };
}

function action(
  after: PageStateSummary,
  before = state({})
): ScenarioActionResult {
  return {
    before,
    after,
    changes: {
      urlChanged: before.url !== after.url,
      titleChanged: before.title !== after.title,
      pageSignatureChanged:
        before.pageSignatureGuess !== after.pageSignatureGuess,
      addedButtons: [],
      removedButtons: ['В корзину'],
      addedTexts: after.visibleTexts,
      removedTexts: []
    },
    observations: []
  };
}

describe('LitRes checkout scenario', () => {
  it('runs to hardStop finalPayload and switches SBP checkout URL to russian_card', async () => {
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const search = state({
      url: 'https://www.litres.ru/search/?q=Sample',
      pageSignatureGuess: 'search_results',
      visibleTexts: ['Результаты поиска', 'Sample Book Result']
    });
    const product = state({
      url: 'https://www.litres.ru/book/sample/',
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Sample Book', 'В корзину']
    });
    const added = state({
      url: product.url,
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Sample Book', 'Added to cart'],
      visibleButtons: [
        { text: '1', role: 'button', type: 'button', ariaLabel: 'cart' }
      ]
    });
    const cart = state({
      url: 'https://www.litres.ru/my-books/cart/',
      pageSignatureGuess: 'cart',
      visibleTexts: ['Ваша корзина', 'Перейти к покупке']
    });
    const checkoutSbp = state({
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=sbp&system=sbersbp',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Оформление покупки', 'СБП', 'Российская карта'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        phase: 'litres_checkout',
        paymentMethod: 'sbp',
        paymentSystem: 'sbersbp'
      }
    });
    const checkoutSberCard = state({
      ...checkoutSbp,
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card&system=sbercard',
      paymentContext: {
        ...checkoutSbp.paymentContext,
        paymentMethod: 'russian_card',
        paymentSystem: 'sbercard'
      }
    });
    const extractionJson = {
      paymentMethod: 'SberPay' as const,
      paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-1',
      paymentOrderId: 'order-1',
      paymentIntents: [{ provider: 'sberpay' as const, orderId: 'order-1' }],
      bankInvoiceId: null,
      merchantOrderNumber: null,
      merchantOrderId: null,
      rawDeeplink: null,
      source: 'url' as const,
      mdOrder: null,
      formUrl: null,
      href: null
    };
    const payecom = state({
      url: 'https://payecom.ru/pay_ru?orderId=order-1',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Войти по Сбер ID'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        shouldReportImmediately: true,
        terminalExtractionResult: true,
        provider: 'sberpay',
        phase: 'payecom_boundary',
        paymentUrl: extractionJson.paymentUrl,
        paymentOrderId: extractionJson.paymentOrderId,
        paymentIntents: extractionJson.paymentIntents,
        extractionJson
      }
    });

    const actionResults = [
      action(product, search),
      action(added, product),
      action(cart, added),
      action(checkoutSbp, cart),
      action(checkoutSberCard, checkoutSbp),
      action(payecom, checkoutSberCard)
    ];
    const controller = {
      observeSession: vi.fn(async () => search),
      actInSession: vi.fn(async () => actionResults.shift()!)
    };

    const result = await runLitresCheckoutScenario({
      controller,
      sessionId: 'session-1',
      pack,
      query: 'Sample'
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-1',
      finalPayload: {
        paymentOrderId: 'order-1'
      }
    });
    expect(controller.actInSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        action: 'navigate',
        url: expect.stringContaining('method=russian_card')
      }),
      expect.objectContaining({ sitePack: pack })
    );
  });

  it('clicks Russian card selector when URL rewrite still leaves SBP selected', async () => {
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const search = state({
      url: 'https://www.litres.ru/search/?q=Sample',
      pageSignatureGuess: 'search_results',
      visibleTexts: ['Результаты поиска', 'Sample Book Result']
    });
    const product = state({
      url: 'https://www.litres.ru/book/sample/',
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Sample Book', 'В корзину']
    });
    const added = state({
      url: product.url,
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Sample Book', 'Added to cart'],
      visibleButtons: [
        { text: '1', role: 'button', type: 'button', ariaLabel: 'cart' }
      ]
    });
    const cart = state({
      url: 'https://www.litres.ru/my-books/cart/',
      pageSignatureGuess: 'cart',
      visibleTexts: ['Ваша корзина', 'Перейти к покупке']
    });
    const checkoutSbp = state({
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=sbp&system=sbersbp',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Оформление покупки', 'СБП', 'Российская карта'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        phase: 'litres_checkout',
        paymentMethod: 'sbp',
        paymentSystem: 'sbersbp'
      }
    });
    const checkoutStillSbp = state({
      ...checkoutSbp,
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card&system=sbercard'
    });
    const checkoutSberCard = state({
      ...checkoutSbp,
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card&system=sbercard',
      paymentContext: {
        ...checkoutSbp.paymentContext,
        paymentMethod: 'russian_card',
        paymentSystem: 'sbercard'
      }
    });
    const extractionJson = {
      paymentMethod: 'SberPay' as const,
      paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-2',
      paymentOrderId: 'order-2',
      paymentIntents: [{ provider: 'sberpay' as const, orderId: 'order-2' }],
      bankInvoiceId: null,
      merchantOrderNumber: null,
      merchantOrderId: null,
      rawDeeplink: null,
      source: 'url' as const,
      mdOrder: null,
      formUrl: null,
      href: null
    };
    const payecom = state({
      url: 'https://payecom.ru/pay_ru?orderId=order-2',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Войти по Сбер ID'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        shouldReportImmediately: true,
        terminalExtractionResult: true,
        provider: 'sberpay',
        phase: 'payecom_boundary',
        paymentUrl: extractionJson.paymentUrl,
        paymentOrderId: extractionJson.paymentOrderId,
        paymentIntents: extractionJson.paymentIntents,
        extractionJson
      }
    });

    const actionResults = [
      action(product, search),
      action(added, product),
      action(cart, added),
      action(checkoutSbp, cart),
      action(checkoutStillSbp, checkoutSbp),
      action(checkoutSberCard, checkoutStillSbp),
      action(payecom, checkoutSberCard)
    ];
    const controller = {
      observeSession: vi.fn(async () => search),
      actInSession: vi.fn(async () => actionResults.shift()!)
    };

    const result = await runLitresCheckoutScenario({
      controller,
      sessionId: 'session-1',
      pack,
      query: 'Sample'
    });

    expect(result).toMatchObject({
      ok: true,
      finalPayload: {
        paymentOrderId: 'order-2'
      }
    });
    expect(controller.actInSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        action: 'click',
        selector: "label[for='payment-method-input_russian_card']"
      }),
      expect.objectContaining({ sitePack: pack })
    );
  });

  it('tries the next search-result target when the first click stays on search results', async () => {
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const search = state({
      url: 'https://www.litres.ru/search/?q=Iliad',
      pageSignatureGuess: 'search_results',
      visibleTexts: ['Результаты поиска', 'Илиада', 'Гомер', '154,90 ₽']
    });
    const product = state({
      url: 'https://www.litres.ru/book/gomer/iliada/',
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Илиада', 'Гомер', 'В корзину']
    });
    const added = state({
      url: product.url,
      pageSignatureGuess: 'product_page',
      visibleTexts: ['Илиада', 'В корзине'],
      visibleButtons: [
        { text: '1', role: 'button', type: 'button', ariaLabel: 'cart' }
      ]
    });
    const cart = state({
      url: 'https://www.litres.ru/my-books/cart/',
      pageSignatureGuess: 'cart',
      visibleTexts: ['Корзина', 'Илиада', 'Перейти к покупке']
    });
    const checkoutSberCard = state({
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card&system=sbercard',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Оформление покупки', 'Российская карта'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        phase: 'litres_checkout',
        paymentMethod: 'russian_card',
        paymentSystem: 'sbercard'
      }
    });
    const payecom = state({
      url: 'https://payecom.ru/pay_ru?orderId=order-3',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Войти по Сбер ID'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        shouldReportImmediately: true,
        terminalExtractionResult: true,
        provider: 'sberpay',
        phase: 'payecom_boundary',
        paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-3',
        paymentOrderId: 'order-3',
        paymentIntents: [{ provider: 'sberpay', orderId: 'order-3' }],
        extractionJson: {
          paymentMethod: 'SberPay',
          paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-3',
          paymentOrderId: 'order-3',
          paymentIntents: [{ provider: 'sberpay', orderId: 'order-3' }],
          bankInvoiceId: null,
          merchantOrderNumber: null,
          merchantOrderId: null,
          rawDeeplink: null,
          source: 'url',
          mdOrder: null,
          formUrl: null,
          href: null
        }
      }
    });

    const actionResults = [
      action(search, search),
      action(product, search),
      action(added, product),
      action(cart, added),
      action(checkoutSberCard, cart),
      action(payecom, checkoutSberCard)
    ];
    const controller = {
      observeSession: vi.fn(async () => search),
      actInSession: vi.fn(async () => actionResults.shift()!)
    };

    const result = await runLitresCheckoutScenario({
      controller,
      sessionId: 'session-1',
      pack,
      query: 'Илиада Гомер текстовая электронная книга'
    });

    expect(result).toMatchObject({
      ok: true,
      finalPayload: {
        paymentOrderId: 'order-3'
      }
    });
    expect(controller.actInSession).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.objectContaining({
        action: 'click',
        selector: expect.stringContaining("a[href*='/book/']")
      }),
      expect.objectContaining({ sitePack: pack })
    );
    expect(controller.actInSession).toHaveBeenNthCalledWith(
      2,
      'session-1',
      expect.objectContaining({
        action: 'click',
        selector: expect.stringContaining("main a[href*='/book/']")
      }),
      expect.objectContaining({ sitePack: pack })
    );
    expect(result.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'select_search_result_candidates' }),
        expect.objectContaining({ step: 'open_search_result_1' }),
        expect.objectContaining({ step: 'open_search_result_2' })
      ])
    );
  });

  it('waits for LitRes search results to render before selecting a candidate', async () => {
    const pack = await matchSitePackByUrl('https://www.litres.ru/');
    const emptySearch = state({
      url: 'https://www.litres.ru/search/?q=1984',
      title: 'Результаты поиска по книгам: «1984»',
      pageSignatureGuess: 'search_results',
      visibleTexts: [],
      visibleButtons: [
        { text: 'Каталог', role: 'button', type: null, ariaLabel: null },
        { text: 'Найти', role: 'button', type: null, ariaLabel: 'Найти 1984' }
      ]
    });
    const renderedSearch = state({
      ...emptySearch,
      visibleTexts: ['Результаты поиска', '1984', 'Джордж Оруэлл', '159 ₽']
    });
    const product = state({
      url: 'https://www.litres.ru/book/dzhordzh-oruell/1984/',
      pageSignatureGuess: 'product_page',
      visibleTexts: ['1984', 'Джордж Оруэлл', 'В корзину']
    });
    const added = state({
      url: product.url,
      pageSignatureGuess: 'product_page',
      visibleTexts: ['1984', 'В корзине'],
      visibleButtons: [
        { text: '1', role: 'button', type: 'button', ariaLabel: 'cart' }
      ]
    });
    const cart = state({
      url: 'https://www.litres.ru/my-books/cart/',
      pageSignatureGuess: 'cart',
      visibleTexts: ['Корзина', '1984', 'Перейти к покупке']
    });
    const checkoutSberCard = state({
      url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card&system=sbercard',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Оформление покупки', 'Российская карта'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        phase: 'litres_checkout',
        paymentMethod: 'russian_card',
        paymentSystem: 'sbercard'
      }
    });
    const payecom = state({
      url: 'https://payecom.ru/pay_ru?orderId=order-4',
      pageSignatureGuess: 'checkout_payment_choice',
      visibleTexts: ['Войти по Сбер ID'],
      paymentContext: {
        ...createEmptyPaymentContext(),
        detected: true,
        shouldReportImmediately: true,
        terminalExtractionResult: true,
        provider: 'sberpay',
        phase: 'payecom_boundary',
        paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-4',
        paymentOrderId: 'order-4',
        paymentIntents: [{ provider: 'sberpay', orderId: 'order-4' }],
        extractionJson: {
          paymentMethod: 'SberPay',
          paymentUrl: 'https://payecom.ru/pay_ru?orderId=order-4',
          paymentOrderId: 'order-4',
          paymentIntents: [{ provider: 'sberpay', orderId: 'order-4' }],
          bankInvoiceId: null,
          merchantOrderNumber: null,
          merchantOrderId: null,
          rawDeeplink: null,
          source: 'url',
          mdOrder: null,
          formUrl: null,
          href: null
        }
      }
    });

    const observations = [emptySearch, renderedSearch];
    const actionResults = [
      action(product, renderedSearch),
      action(added, product),
      action(cart, added),
      action(checkoutSberCard, cart),
      action(payecom, checkoutSberCard)
    ];
    const controller = {
      observeSession: vi.fn(async () => observations.shift() ?? renderedSearch),
      actInSession: vi.fn(async () => actionResults.shift()!)
    };

    const result = await runLitresCheckoutScenario({
      controller,
      sessionId: 'session-1',
      pack,
      query: '1984 Джордж Оруэлл текстовая электронная версия',
      searchResultPollDelayMs: 0
    });

    expect(result).toMatchObject({
      ok: true,
      finalPayload: {
        paymentOrderId: 'order-4'
      }
    });
    expect(controller.observeSession).toHaveBeenCalledTimes(2);
    expect(result.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'observe_search_results_retry_1' }),
        expect.objectContaining({
          step: 'select_search_result_candidates',
          status: 'ok',
          detail: expect.stringContaining('"visibleTextCount":4')
        })
      ])
    );
  });
});
