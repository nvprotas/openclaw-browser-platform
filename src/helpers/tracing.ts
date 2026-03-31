import type { ActionDiffSummary, ActionObservationSummary } from '../daemon/types.js';
import type { PageStateSummary } from '../playwright/browser-session.js';

function normalize(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

export function summarizeObservation(state: PageStateSummary): ActionObservationSummary[] {
  const observations: ActionObservationSummary[] = [];

  if (state.pageSignatureGuess === 'cart') {
    observations.push({ level: 'info', code: 'CART_VISIBLE', message: 'Cart-like signals are visible on the page.' });
  }

  if (state.pageSignatureGuess === 'product_page') {
    observations.push({ level: 'info', code: 'PRODUCT_CTA_VISIBLE', message: 'Product purchase/add-to-cart CTA signals are visible.' });
  }

  if (state.pageSignatureGuess === 'search_results') {
    observations.push({ level: 'info', code: 'SEARCH_RESULTS_VISIBLE', message: 'Search/results-like signals are visible.' });
  }

  if (state.visibleButtons.length === 0) {
    observations.push({ level: 'warning', code: 'NO_VISIBLE_BUTTONS', message: 'No visible buttons were detected after the action.' });
  }

  return observations;
}

export function buildActionDiff(before: PageStateSummary, after: PageStateSummary): ActionDiffSummary {
  const beforeButtons = new Set(normalize(before.visibleButtons.map((button) => button.text || button.ariaLabel || '')));
  const afterButtons = normalize(after.visibleButtons.map((button) => button.text || button.ariaLabel || ''));
  const beforeTexts = new Set(normalize(before.visibleTexts));
  const afterTexts = normalize(after.visibleTexts);

  return {
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    pageSignatureChanged: before.pageSignatureGuess !== after.pageSignatureGuess,
    addedButtons: afterButtons.filter((text) => !beforeButtons.has(text)).slice(0, 8),
    removedButtons: [...beforeButtons].filter((text) => !afterButtons.includes(text)).slice(0, 8),
    addedTexts: afterTexts.filter((text) => !beforeTexts.has(text)).slice(0, 8),
    removedTexts: [...beforeTexts].filter((text) => !afterTexts.includes(text)).slice(0, 8)
  };
}
