import type { ActionObservationSummary } from '../daemon/types.js';
import type { BrowserSession } from '../playwright/browser-session.js';

export interface SizeSelectionResult {
  status: 'selected' | 'not_required' | 'not_found';
  text: string | null;
  selector: string | null;
}

export async function selectFirstAvailableSize(
  session: BrowserSession
): Promise<SizeSelectionResult> {
  return session.page().evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const isDisabled = (element: HTMLElement): boolean => {
      const className = element.className.toString().toLowerCase();
      return (
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        /disabled|unavailable|_disabled|_unavailable/.test(className)
      );
    };

    const bodyText = normalize(
      document.body?.innerText || document.body?.textContent
    ).toLowerCase();
    if (!/доступные размеры|размер/.test(bodyText)) {
      return {
        status: 'not_required',
        text: null,
        selector: null
      } satisfies SizeSelectionResult;
    }

    const containers = Array.from(
      document.querySelectorAll<HTMLElement>('*')
    ).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const text = normalize(
        element.innerText || element.textContent
      ).toLowerCase();
      return /доступные размеры/.test(text);
    });
    const root =
      containers.sort(
        (left, right) =>
          left.getBoundingClientRect().height -
          right.getBoundingClientRect().height
      )[0] ?? document.body;

    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [role="button"], label, a, [class*="size"], [class*="Размер"], [class*="razmer"]'
      )
    ).filter((element) => {
      if (!isVisible(element) || isDisabled(element)) {
        return false;
      }

      const text = normalize(
        element.innerText ||
          element.textContent ||
          element.getAttribute('aria-label')
      );
      return text.length > 0 && text.length <= 16;
    });

    const candidate = candidates[0];
    if (!candidate) {
      return {
        status: 'not_found',
        text: null,
        selector: null
      } satisfies SizeSelectionResult;
    }

    const text = normalize(
      candidate.innerText ||
        candidate.textContent ||
        candidate.getAttribute('aria-label')
    );
    candidate.click();
    const selector = candidate.id
      ? `#${candidate.id}`
      : candidate.getAttribute('data-testid')
        ? `[data-testid="${candidate.getAttribute('data-testid')}"]`
        : null;

    return {
      status: 'selected',
      text: text || null,
      selector
    } satisfies SizeSelectionResult;
  });
}

export function buildSizeSelectionObservation(
  result: SizeSelectionResult
): ActionObservationSummary | null {
  if (result.status === 'selected') {
    return {
      level: 'info',
      code: 'SIZE_SELECTED',
      message: `Selected product size${result.text ? ` "${result.text}"` : ''}.`
    };
  }

  if (result.status === 'not_found') {
    return {
      level: 'warning',
      code: 'SIZE_SELECTION_REQUIRED',
      message:
        'Size selection appears to be required, but no available size option was found.'
    };
  }

  return null;
}
