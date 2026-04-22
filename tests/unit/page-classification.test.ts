import { describe, expect, it } from 'vitest';
import { guessPageSignature } from '../../src/playwright/page-classification.js';
import type { PageSignatureInput } from '../../src/playwright/page-classification.js';

function fixture(input: Partial<PageSignatureInput>): PageSignatureInput {
  return {
    url: 'https://example.com/',
    visibleTexts: [],
    visibleButtons: [],
    forms: [],
    ...input
  };
}

describe('page classification', () => {
  it('does not classify brandshop home or search pages as cart because of header cart text', () => {
    expect(
      guessPageSignature(
        fixture({
          url: 'https://brandshop.ru/',
          visibleTexts: [
            'Интернет-магазин модной одежды и обуви BRANDSHOP',
            'Новинки',
            'Бренды',
            'Корзина'
          ]
        })
      )
    ).toBe('home');

    expect(
      guessPageSignature(
        fixture({
          url: 'https://brandshop.ru/search/?q=кроссовки',
          visibleTexts: ['Результаты поиска', 'Корзина', 'Изменить запрос']
        })
      )
    ).toBe('search_results');
  });

  it('keeps brandshop /goods/ pages as product pages even when the header has cart text', () => {
    expect(
      guessPageSignature(
        fixture({
          url: 'https://brandshop.ru/goods/123/test/',
          visibleTexts: ['Доступные размеры', 'Корзина'],
          visibleButtons: [
            {
              text: 'Добавить в корзину',
              role: 'button',
              type: 'button',
              ariaLabel: null
            }
          ]
        })
      )
    ).toBe('product_page');

    expect(
      guessPageSignature(
        fixture({
          url: 'https://brandshop.ru/goods/123/test/',
          visibleTexts: ['Доступные размеры', 'Товар добавлен'],
          visibleButtons: [
            {
              text: 'Перейти в корзину',
              role: 'button',
              type: 'button',
              ariaLabel: null
            }
          ]
        })
      )
    ).toBe('product_page');
  });

  it('still recognizes real cart and LitRes checkout states', () => {
    expect(
      guessPageSignature(
        fixture({
          url: 'https://www.litres.ru/my-books/cart/',
          visibleTexts: ['Ваша корзина', 'Состав заказа']
        })
      )
    ).toBe('cart');

    expect(
      guessPageSignature(
        fixture({
          url: 'https://www.litres.ru/purchase/ppd/?order=1&method=russian_card',
          visibleTexts: ['Оформление покупки', 'Способ оплаты']
        })
      )
    ).toBe('checkout_payment_choice');
  });
});
