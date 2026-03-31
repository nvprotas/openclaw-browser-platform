import type { ActionDiffSummary, ActionObservationSummary, ClickActionPayload, SessionObservation } from '../daemon/types.js';
import type { LoadedSitePack } from '../packs/loader.js';

function unique<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function readPackStrings(pack: LoadedSitePack | null | undefined, section: string, key: string): string[] {
  const raw = pack?.pack.hints.raw;
  const bucket = raw?.[section];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    return [];
  }

  const values = (bucket as Record<string, unknown>)[key];
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

export function findAddToCartTargets(pack: LoadedSitePack | null | undefined): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'add_to_cart');
  const buttonTexts = readPackStrings(pack, 'button_texts', 'add_to_cart');

  return unique([
    ...selectors.map<ClickActionPayload>((selector) => ({ action: 'click', selector })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({ action: 'click', role: 'button', name })),
    ...buttonTexts.map<ClickActionPayload>((text) => ({ action: 'click', text }))
  ]);
}

export function findOpenCartTargets(pack: LoadedSitePack | null | undefined): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'cart_link');
  const buttonTexts = readPackStrings(pack, 'button_texts', 'open_cart');

  return unique([
    ...selectors.map<ClickActionPayload>((selector) => ({ action: 'click', selector })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({ action: 'click', role: 'button', name })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({ action: 'click', role: 'link', name })),
    ...buttonTexts.map<ClickActionPayload>((text) => ({ action: 'click', text }))
  ]);
}

function observationCodes(observations: ActionObservationSummary[]): Set<string> {
  return new Set(observations.map((observation) => observation.code));
}

function hasVisibleText(observation: Pick<SessionObservation, 'visibleTexts'>, pattern: RegExp): boolean {
  return observation.visibleTexts.some((text) => pattern.test(text));
}

export function isAddToCartConfirmed(input: {
  before: Pick<SessionObservation, 'visibleTexts' | 'visibleButtons' | 'pageSignatureGuess'>;
  after: Pick<SessionObservation, 'visibleTexts' | 'visibleButtons' | 'pageSignatureGuess'>;
  changes: ActionDiffSummary;
  observations: ActionObservationSummary[];
}): boolean {
  const codes = observationCodes(input.observations);

  if (codes.has('CART_VISIBLE')) {
    return true;
  }

  if (input.after.pageSignatureGuess === 'cart') {
    return true;
  }

  if (input.changes.urlChanged || input.changes.pageSignatureChanged) {
    if (input.after.pageSignatureGuess === 'cart') {
      return true;
    }
  }

  if (input.changes.addedTexts.some((text) => /added to cart|добавлен[ао]? в корзин|в корзину/i.test(text))) {
    return true;
  }

  if (input.changes.addedButtons.some((text) => /added|added to cart|в корзин|в корзине|перейти в корзину/i.test(text))) {
    return true;
  }

  if (input.changes.removedButtons.some((text) => /в корзину|купить|add to cart|buy/i.test(text))) {
    return true;
  }

  if (hasVisibleText(input.after, /ваша корзина|состав заказа|оформить заказ|added to cart|добавлен[ао]? в корзин/i)) {
    return true;
  }

  const beforeCartCount = input.before.visibleTexts.join(' ');
  const afterCartCount = input.after.visibleTexts.join(' ');
  const cartCounterPattern = /\b(\d+)\s+корзин(?:а|е|у|ы)?\b/i;
  const beforeMatch = beforeCartCount.match(cartCounterPattern);
  const afterMatch = afterCartCount.match(cartCounterPattern);
  if (afterMatch && (!beforeMatch || afterMatch[1] !== beforeMatch[1])) {
    return true;
  }

  return false;
}

export function isCartVisible(observation: Pick<SessionObservation, 'pageSignatureGuess' | 'visibleTexts' | 'url'>): boolean {
  if (observation.pageSignatureGuess === 'cart') {
    return true;
  }

  if (/\/cart\b|\/basket\b/i.test(observation.url)) {
    return true;
  }

  return hasVisibleText(observation, /корзин|your cart|basket|оформить заказ|состав заказа/i);
}
