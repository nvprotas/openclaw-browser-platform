import { describe, expect, it } from 'vitest';
import { findAddToCartTargets, findOpenCartTargets, isAddToCartConfirmed, isCartVisible } from '../../src/helpers/cart.js';
import { matchSitePackByUrl } from '../../src/packs/loader.js';

describe('cart helpers', () => {
  it('derives LitRes add-to-cart and open-cart targets from the pack', async () => {
    const matched = await matchSitePackByUrl('https://www.litres.ru/');
    expect(matched).not.toBeNull();

    expect(findAddToCartTargets(matched)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'click', selector: "button:has-text('В корзину')" }),
        expect.objectContaining({ action: 'click', role: 'button', name: 'В корзину' })
      ])
    );

    expect(findOpenCartTargets(matched)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'click', selector: "a[href*='cart']" }),
        expect.objectContaining({ action: 'click', role: 'link', name: 'Корзина' })
      ])
    );
  });

  it('confirms add-to-cart from cart-related UI changes', () => {
    expect(
      isAddToCartConfirmed({
        before: {
          pageSignatureGuess: 'product_page',
          visibleTexts: ['Sample Book', 'Корзина'],
          visibleButtons: [{ text: 'В корзину', role: 'button', type: 'button', ariaLabel: null }]
        },
        after: {
          pageSignatureGuess: 'product_page',
          visibleTexts: ['Sample Book', '1 Корзина', 'Added to cart'],
          visibleButtons: [{ text: 'Added', role: 'button', type: 'button', ariaLabel: null }]
        },
        changes: {
          urlChanged: false,
          titleChanged: false,
          pageSignatureChanged: false,
          addedButtons: ['Added'],
          removedButtons: ['В корзину'],
          addedTexts: ['1 Корзина', 'Added to cart'],
          removedTexts: []
        },
        observations: []
      })
    ).toBe(true);
  });

  it('treats cart page/cart signals as successful add-to-cart and visible cart', () => {
    const after = {
      pageSignatureGuess: 'cart',
      url: 'https://www.litres.ru/cart/',
      visibleTexts: ['Ваша корзина', 'Оформить заказ'],
      visibleButtons: []
    };

    expect(
      isAddToCartConfirmed({
        before: {
          pageSignatureGuess: 'product_page',
          visibleTexts: ['Sample Book'],
          visibleButtons: []
        },
        after,
        changes: {
          urlChanged: true,
          titleChanged: true,
          pageSignatureChanged: true,
          addedButtons: [],
          removedButtons: [],
          addedTexts: ['Ваша корзина'],
          removedTexts: []
        },
        observations: [{ level: 'info', code: 'CART_VISIBLE', message: 'Cart-like signals are visible on the page.' }]
      })
    ).toBe(true);

    expect(isCartVisible(after)).toBe(true);
  });
});
