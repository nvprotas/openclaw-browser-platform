import type {
  ActionDiffSummary,
  ActionObservationSummary,
  ClickActionPayload,
  SessionActionPayload,
  SessionObservation
} from '../daemon/types.js';
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

function readPackStrings(
  pack: LoadedSitePack | null | undefined,
  section: string,
  key: string
): string[] {
  const raw = pack?.pack.hints.raw;
  const bucket = raw?.[section];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
    return [];
  }

  const values = (bucket as Record<string, unknown>)[key];
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

export function findAddToCartTargets(
  pack: LoadedSitePack | null | undefined
): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'add_to_cart');
  const buttonTexts = readPackStrings(pack, 'button_texts', 'add_to_cart');

  return unique([
    ...selectors.map<ClickActionPayload>((selector) => ({
      action: 'click',
      selector
    })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({
      action: 'click',
      role: 'button',
      name
    })),
    ...buttonTexts.map<ClickActionPayload>((text) => ({
      action: 'click',
      text
    }))
  ]);
}

export function findOpenCartTargets(
  pack: LoadedSitePack | null | undefined
): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'cart_link');
  const buttonTexts = readPackStrings(pack, 'button_texts', 'open_cart');

  return unique([
    ...selectors.map<ClickActionPayload>((selector) => ({
      action: 'click',
      selector
    })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({
      action: 'click',
      role: 'button',
      name
    })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({
      action: 'click',
      role: 'link',
      name
    })),
    ...buttonTexts.map<ClickActionPayload>((text) => ({
      action: 'click',
      text
    }))
  ]);
}

function observationCodes(
  observations: ActionObservationSummary[]
): Set<string> {
  return new Set(observations.map((observation) => observation.code));
}

function hasVisibleText(
  observation: Pick<SessionObservation, 'visibleTexts'>,
  pattern: RegExp
): boolean {
  return observation.visibleTexts.some((text) => pattern.test(text));
}

export function is404LikePage(
  observation: Pick<
    SessionObservation,
    'pageSignatureGuess' | 'visibleTexts' | 'url' | 'title'
  >
): boolean {
  const text = `${observation.title} ${observation.visibleTexts.join(' ')}`;
  return (
    observation.pageSignatureGuess === 'unknown' &&
    /\b404\b|not found|страница не найдена|ничего не найдено/i.test(text)
  );
}

function targetBlob(payload: SessionActionPayload): string {
  const selector = 'selector' in payload ? (payload.selector ?? '') : '';
  const targetName = 'name' in payload ? (payload.name ?? '') : '';
  const targetText = 'text' in payload ? (payload.text ?? '') : '';
  const url = 'url' in payload ? (payload.url ?? '') : '';
  return `${selector} ${targetName} ${targetText} ${url}`.toLowerCase();
}

export function isLikelyCartNavigationAction(
  payload: SessionActionPayload
): boolean {
  if (payload.action !== 'click' && payload.action !== 'navigate') {
    return false;
  }

  return /cart|basket|checkout|корзин|оформить заказ|перейти к покупке/.test(
    targetBlob(payload)
  );
}

export function buildFailedCartNavigationObservation(
  payload: SessionActionPayload,
  after: Pick<
    SessionObservation,
    'pageSignatureGuess' | 'visibleTexts' | 'url' | 'title'
  >
): ActionObservationSummary | null {
  if (!isLikelyCartNavigationAction(payload) || !is404LikePage(after)) {
    return null;
  }

  return {
    level: 'warning',
    code: 'FAILED_CART_NAVIGATION',
    message:
      'Cart navigation produced a 404-like page. Try the next cart target from the site-pack hints.'
  };
}

function extractCartCounterValues(
  observation: Pick<SessionObservation, 'visibleTexts' | 'visibleButtons'>
): number[] {
  const values: number[] = [];
  const collect = (value: string): void => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    const cartCounterMatch = normalized.match(
      /\b(\d+)\s*(?:корзин|cart|basket)?\b/i
    );
    if (cartCounterMatch?.[1]) {
      values.push(Number(cartCounterMatch[1]));
    }
  };

  observation.visibleTexts
    .filter((text) => /корзин|cart|basket/i.test(text))
    .forEach(collect);
  observation.visibleButtons
    .filter((button) =>
      /cart|basket|корзин/i.test(`${button.text} ${button.ariaLabel ?? ''}`)
    )
    .forEach((button) => collect(`${button.text} ${button.ariaLabel ?? ''}`));

  return values.filter((value) => Number.isFinite(value));
}

export function isAddToCartConfirmed(input: {
  before: Pick<
    SessionObservation,
    'visibleTexts' | 'visibleButtons' | 'pageSignatureGuess'
  >;
  after: Pick<
    SessionObservation,
    'visibleTexts' | 'visibleButtons' | 'pageSignatureGuess'
  >;
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

  if (
    input.changes.addedTexts.some((text) =>
      /added to cart|добавлен[ао]? в корзин|в корзину/i.test(text)
    )
  ) {
    return true;
  }

  if (
    input.changes.addedButtons.some((text) =>
      /added|added to cart|в корзин|в корзине|перейти в корзину/i.test(text)
    )
  ) {
    return true;
  }

  if (
    input.changes.removedButtons.some((text) =>
      /в корзину|купить|add to cart|buy/i.test(text)
    )
  ) {
    return true;
  }

  if (
    hasVisibleText(
      input.after,
      /ваша корзина|состав заказа|оформить заказ|added to cart|добавлен[ао]? в корзин/i
    )
  ) {
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

  const beforeCounters = extractCartCounterValues(input.before);
  const afterCounters = extractCartCounterValues(input.after);
  if (
    afterCounters.some((afterValue) => afterValue > 0) &&
    (beforeCounters.length === 0 ||
      afterCounters.join(',') !== beforeCounters.join(','))
  ) {
    return true;
  }

  return false;
}

export function isCartVisible(
  observation: Pick<
    SessionObservation,
    'pageSignatureGuess' | 'visibleTexts' | 'url'
  >
): boolean {
  if (observation.pageSignatureGuess === 'cart') {
    return true;
  }

  if (/\/cart\b|\/basket\b/i.test(observation.url)) {
    return true;
  }

  return hasVisibleText(
    observation,
    /корзин|your cart|basket|оформить заказ|состав заказа/i
  );
}
