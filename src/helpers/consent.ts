import type { ActionObservationSummary } from '../daemon/types.js';
import type { LoadedSitePack } from '../packs/loader.js';
import type {
  PageStateSummary,
  BrowserSession
} from '../playwright/browser-session.js';

export interface CookieConsentResult {
  status: 'accepted' | 'not_found';
  selector: string | null;
  text: string | null;
}

const DEFAULT_ACCEPT_TEXTS = [
  'Принять',
  'Принимаю',
  'Согласен',
  'Accept',
  'OK'
];
const DEFAULT_SELECTORS = [
  "button:has-text('Принять')",
  "[class*='cookie'] button"
];

function readPackStrings(
  pack: LoadedSitePack | null | undefined,
  key: 'accept_texts' | 'selectors'
): string[] {
  const raw = pack?.pack.hints.raw.cookie_consent;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }

  const values = (raw as Record<string, unknown>)[key];
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

export function shouldAttemptCookieConsent(
  observation: Pick<PageStateSummary, 'visibleButtons'>,
  pack?: LoadedSitePack | null
): boolean {
  const acceptTexts = [
    ...readPackStrings(pack, 'accept_texts'),
    ...DEFAULT_ACCEPT_TEXTS
  ].map((value) => value.toLowerCase());
  return observation.visibleButtons.some((button) => {
    const text = `${button.text} ${button.ariaLabel ?? ''}`
      .trim()
      .toLowerCase();
    return acceptTexts.some((acceptText) => text === acceptText.toLowerCase());
  });
}

export async function acceptCookieConsent(
  session: BrowserSession,
  pack?: LoadedSitePack | null
): Promise<CookieConsentResult> {
  const selectors = [
    ...readPackStrings(pack, 'selectors'),
    ...DEFAULT_SELECTORS
  ];
  const acceptTexts = [
    ...readPackStrings(pack, 'accept_texts'),
    ...DEFAULT_ACCEPT_TEXTS
  ];

  const result = await session.page().evaluate(
    ({ selectorsToTry, textsToTry }) => {
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

      const click = (
        element: HTMLElement,
        selector: string | null
      ): CookieConsentResult => {
        const text = normalize(
          element.innerText ||
            element.textContent ||
            element.getAttribute('aria-label')
        );
        element.click();
        return { status: 'accepted', selector, text: text || null };
      };

      for (const selector of selectorsToTry) {
        let candidate: Element | null = null;
        try {
          candidate = document.querySelector(selector);
        } catch {
          candidate = null;
        }
        if (isVisible(candidate)) {
          return click(candidate, selector);
        }
      }

      const normalizedTexts = textsToTry
        .map((text) => normalize(text).toLowerCase())
        .filter(Boolean);
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, [role="button"], input[type="button"], input[type="submit"]'
        )
      );
      const candidate = buttons.find((button) => {
        if (!isVisible(button)) {
          return false;
        }

        const text = normalize(
          button instanceof HTMLInputElement
            ? button.value
            : button.innerText ||
                button.textContent ||
                button.getAttribute('aria-label')
        ).toLowerCase();
        return normalizedTexts.includes(text);
      });

      if (candidate) {
        return click(candidate, null);
      }

      return {
        status: 'not_found',
        selector: null,
        text: null
      } satisfies CookieConsentResult;
    },
    { selectorsToTry: selectors, textsToTry: acceptTexts }
  );

  if (result.status === 'accepted') {
    await Promise.race([
      session
        .page()
        .waitForLoadState('domcontentloaded', { timeout: 1000 })
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return result;
}

export function buildCookieConsentObservation(
  result: CookieConsentResult
): ActionObservationSummary | null {
  if (result.status !== 'accepted') {
    return null;
  }

  return {
    level: 'info',
    code: 'COOKIE_CONSENT_ACCEPTED',
    message: `Accepted cookie consent${result.text ? ` using "${result.text}"` : ''}.`
  };
}
