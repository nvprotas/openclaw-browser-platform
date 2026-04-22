import type { FormSummary, VisibleButtonSummary } from './dom-utils.js';

export interface PageSignatureInput {
  url: string;
  visibleTexts: string[];
  visibleButtons: VisibleButtonSummary[];
  forms: FormSummary[];
}

function joinLower(values: string[]): string {
  return values.join(' ').toLowerCase();
}

export function guessPageSignature(input: PageSignatureInput): string {
  const lowerTexts = joinLower(input.visibleTexts);
  const buttonTexts = joinLower(
    input.visibleButtons.map((button) =>
      `${button.text} ${button.ariaLabel ?? ''}`.trim()
    )
  );
  const currentUrl = input.url;
  const lowerUrl = currentUrl.toLowerCase();
  const hostname = (() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return '';
    }
  })();

  const hasSearchSignals =
    /search|найти|поиск|каталог|catalog|my books|мои книги/.test(lowerTexts);
  const hasHomeSignals =
    hasSearchSignals ||
    /интернет-магазин|новинки|бренды|мужское|женское/.test(lowerTexts);
  const hasAuthWords = /sign in|log in|войти|password|пароль/.test(lowerTexts);
  const hasSearchForm = input.forms.some((form) =>
    (form.action ?? '').toLowerCase().includes('/search')
  );
  const hasLikelyAuthForm = input.forms.some(
    (form) =>
      form.inputCount >= 2 &&
      !(form.action ?? '').toLowerCase().includes('/search')
  );

  const urlHasSearch = /[?&](?:q|query)=|\/search/i.test(currentUrl);
  const urlHasCart = /\/(?:cart|basket)(?:\/|$)|\/my-books\/cart/i.test(
    currentUrl
  );
  const urlHasCheckout = /\/purchase\/ppd\b/i.test(currentUrl);
  const urlHasGenericCheckout = /\/checkout(?:\/|$)/i.test(currentUrl);
  const urlHasProduct = /\/book\/|\/audiobook\/|\/product\/|\/goods\//i.test(
    currentUrl
  );
  const isBrandshopProduct =
    /(?:^|\.)brandshop\.ru$/i.test(hostname) && /\/goods\//i.test(lowerUrl);

  const combinedText = `${lowerTexts} ${buttonTexts}`;
  const hasBuyButtons =
    /buy|add to cart|purchase|купить|в корзину|добавить в корзину/.test(
      buttonTexts
    );
  const hasOrderSummarySignals =
    /оформить заказ|состав заказа|ваша корзина|your cart|proceed to checkout/i.test(
      combinedText
    );

  if (urlHasCheckout) {
    return 'checkout_payment_choice';
  }

  if (hasLikelyAuthForm || (hasAuthWords && !hasHomeSignals)) {
    return 'auth_form';
  }

  if (isBrandshopProduct) {
    return 'product_page';
  }

  if (
    urlHasSearch ||
    /search results|results for|результаты поиска|найден|результат/.test(
      combinedText
    )
  ) {
    return 'search_results';
  }

  if (urlHasCart || urlHasGenericCheckout || hasOrderSummarySignals) {
    return 'cart';
  }

  if (urlHasProduct || hasBuyButtons) {
    return 'product_page';
  }

  if (hasHomeSignals || hasSearchForm) {
    return 'home';
  }

  return input.visibleTexts.length > 0 ? 'content_page' : 'unknown';
}
