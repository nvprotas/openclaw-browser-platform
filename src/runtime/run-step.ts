import { BrowserPlatformError } from '../core/errors.js';
import type {
  ActionObservationSummary,
  SessionActionPayload,
  SessionPaymentContext
} from '../daemon/types.js';
import { withRetry } from '../helpers/retries.js';
import { buildPostActionObservations } from '../helpers/validation.js';
import { buildActionDiff } from '../helpers/tracing.js';
import { extractPaymentContext } from '../helpers/payment-context.js';
import type {
  BrowserSession,
  PageStateSummary
} from '../playwright/browser-session.js';
import type { Frame, Locator, Request, Route } from 'playwright';

const PAYMENT_GATEWAY_URL_PATTERN =
  /^https:\/\/(?:www\.)?payecom\.ru\/pay(?:_ru)?\?/i;
const MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS = 2;

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

async function resolveLocator(
  session: BrowserSession,
  action: Exclude<SessionActionPayload, { action: 'navigate' | 'wait_for' }>
) {
  if (action.selector) {
    return session.page().locator(action.selector).first();
  }

  if (action.role) {
    return session
      .page()
      .getByRole(
        action.role as never,
        action.name ? { name: action.name } : undefined
      )
      .first();
  }

  if (action.text) {
    return session
      .page()
      .getByText(action.text, { exact: action.exact ?? false })
      .first();
  }

  throw new BrowserPlatformError(
    'Action target requires selector, role, or text',
    { code: 'ACTION_TARGET_REQUIRED' }
  );
}

async function waitForNavigationSettled(
  session: BrowserSession
): Promise<void> {
  const page = session.page();
  const urlBefore = page.url();

  try {
    await page.waitForURL((url) => url.href !== urlBefore, { timeout: 1500 });
    await page
      .waitForLoadState('domcontentloaded', { timeout: 3000 })
      .catch(() => undefined);
  } catch {
    // Клик мог менять состояние без навигации: AJAX, toggle или локальный UI.
  }
}

export interface ModalDismissResult {
  status: 'none' | 'dismissed' | 'not_dismissible';
  reason: string;
  selector: string | null;
  text: string | null;
  blocker: string | null;
}

function buildModalObservation(
  result: ModalDismissResult
): ActionObservationSummary | null {
  if (result.status === 'dismissed') {
    return {
      level: 'info' as const,
      code: 'BLOCKING_MODAL_DISMISSED',
      message: `Dismissed blocking modal${result.text ? ` using "${result.text}"` : ''}.`
    };
  }

  if (result.status === 'not_dismissible') {
    return {
      level: 'warning' as const,
      code: 'MODAL_NOT_DISMISSIBLE',
      message: result.reason
    };
  }

  return null;
}

function uniqueObservations(
  observations: Array<ActionObservationSummary | null>
): ActionObservationSummary[] {
  const seen = new Set<string>();
  const result: ActionObservationSummary[] = [];
  for (const observation of observations) {
    if (!observation) {
      continue;
    }
    const key = `${observation.code}|${observation.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(observation);
  }
  return result;
}

async function describePointBlocker(locator: Locator): Promise<string | null> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    return null;
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return locator
    .page()
    .evaluate(
      ({ xPos, yPos }) => {
        // evaluate выполняется в браузерном контексте, поэтому локальные helper'ы
        // не могут переиспользовать функции из Node-контекста этого модуля.
        const normalize = (value: string | null | undefined): string =>
          (value ?? '').replace(/\s+/g, ' ').trim();
        const element = document.elementFromPoint(xPos, yPos);
        if (!element) {
          return null;
        }

        const parts: string[] = [];
        let current: Element | null = element;
        while (current && parts.length < 4) {
          const testId = current.getAttribute('data-testid');
          const id = current.id ? `#${current.id}` : '';
          const role = current.getAttribute('role');
          const aria = current.getAttribute('aria-label');
          const text = normalize(current.textContent).slice(0, 80);
          parts.push(
            [
              current.tagName.toLowerCase(),
              id,
              testId ? `[data-testid="${testId}"]` : '',
              role ? `[role="${role}"]` : '',
              aria ? `[aria-label="${aria}"]` : '',
              text ? `text="${text}"` : ''
            ]
              .filter(Boolean)
              .join('')
          );
          current = current.parentElement;
        }

        return parts.join(' <- ');
      },
      { xPos: x, yPos: y }
    )
    .catch(() => null);
}

export async function dismissBlockingModals(
  session: BrowserSession,
  blocker: string | null = null
): Promise<ModalDismissResult> {
  const result = await session.page().evaluate((blockerDescription) => {
    // evaluate выполняется в браузерном контексте, поэтому локальные helper'ы
    // не могут переиспользовать функции из Node-контекста этого модуля.
    const normalize = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0.01 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const textOf = (element: Element | null): string =>
      normalize(element?.textContent).slice(0, 300);
    const click = (
      element: HTMLElement,
      selector: string | null
    ): ModalDismissResult => {
      const text =
        normalize(element.innerText || element.textContent).slice(0, 80) ||
        normalize(element.getAttribute('aria-label'));
      element.click();
      return {
        status: 'dismissed',
        reason: 'dismissed by safe modal control',
        selector,
        text: text || null,
        blocker: blockerDescription
      };
    };

    // Это runtime-defaults для разных сайтов. LitRes site-pack дублирует
    // проверенные селекторы как документацию/подсказки для агентов.
    const rootSelectors = [
      '[data-testid="modal--overlay"]',
      '[data-testid="modal--wrapper"]',
      '#litres-modal-container',
      '[role="dialog"]',
      '[aria-modal="true"]'
    ];
    const safeClickSelectors = [
      '[data-testid="modal--overlay"] header > div:nth-child(2)',
      '[data-testid="modal--wrapper"] header > div:nth-child(2)',
      '[data-testid="modal--close-button"]',
      '[data-testid="icon_close"]',
      'button[aria-label*="Закрыть"]',
      'button[aria-label*="Close"]',
      '[role="button"][aria-label*="Закрыть"]',
      '[role="button"][aria-label*="Close"]'
    ];
    const safeButtonPattern =
      /^(?:принять|закрыть|не сейчас|позже|понятно|ok|okay|accept|close)$/i;
    const authPattern =
      /войти|авторизац|номер телефона|пароль|продолжить|другие способы|sber id|сбер id/i;
    const authSelectors = [
      '[data-testid^="auth__"]',
      'input[type="password"]',
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[name*="password" i]'
    ];

    const roots = rootSelectors
      .flatMap((selector) =>
        Array.from(document.querySelectorAll(selector))
          .filter(isVisible)
          .map((element) => ({ element, selector }))
      )
      .filter(
        (entry, index, all) =>
          all.findIndex((other) => other.element === entry.element) === index
      );
    const root = roots[0] ?? null;

    if (root) {
      const rootText = textOf(root.element);
      const hasAuthControl = authSelectors.some((selector) =>
        root.element.querySelector(selector)
      );
      if (hasAuthControl && authPattern.test(rootText)) {
        return {
          status: 'not_dismissible',
          reason: 'Blocking modal looks like an authentication gate.',
          selector: root.selector,
          text: rootText || null,
          blocker: blockerDescription
        } satisfies ModalDismissResult;
      }

      for (const selector of safeClickSelectors) {
        const candidate =
          root.element.querySelector(selector) ??
          document.querySelector(selector);
        if (isVisible(candidate)) {
          return click(candidate, selector);
        }
      }

      const buttons = Array.from(
        root.element.querySelectorAll<HTMLElement>('button, [role="button"], a')
      );
      const safeButton = buttons.find(
        (button) =>
          isVisible(button) &&
          safeButtonPattern.test(
            normalize(
              button.innerText ||
                button.textContent ||
                button.getAttribute('aria-label')
            )
          )
      );
      if (safeButton) {
        return click(safeButton, null);
      }

      return {
        status: 'not_dismissible',
        reason: 'Blocking modal has no safe dismiss control.',
        selector: root.selector,
        text: rootText || null,
        blocker: blockerDescription
      } satisfies ModalDismissResult;
    }

    const globalSafeButton = blockerDescription
      ? Array.from(
          document.querySelectorAll<HTMLElement>('button, [role="button"]')
        ).find((button) => {
          if (!isVisible(button)) {
            return false;
          }

          const text = normalize(
            button.innerText ||
              button.textContent ||
              button.getAttribute('aria-label')
          );
          if (!safeButtonPattern.test(text)) {
            return false;
          }

          const rect = button.getBoundingClientRect();
          return rect.width >= 20 && rect.height >= 20;
        })
      : null;

    if (globalSafeButton) {
      return click(globalSafeButton, null);
    }

    return {
      status: 'none',
      reason: 'No visible blocking modal found.',
      selector: null,
      text: null,
      blocker: blockerDescription
    } satisfies ModalDismissResult;
  }, blocker);

  if (result.status === 'dismissed') {
    await Promise.race([
      session
        .page()
        .waitForLoadState('domcontentloaded', { timeout: 1000 })
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return result;
}

function paymentFingerprint(context: SessionPaymentContext): string {
  return JSON.stringify({
    detected: context.detected,
    provider: context.provider,
    phase: context.phase,
    paymentMethod: context.paymentMethod,
    paymentSystem: context.paymentSystem,
    paymentUrl: context.paymentUrl,
    paymentOrderId: context.paymentOrderId,
    litresOrder: context.litresOrder,
    traceId: context.traceId,
    bankInvoiceId: context.bankInvoiceId,
    merchantOrderNumber: context.merchantOrderNumber,
    merchantOrderId: context.merchantOrderId,
    mdOrder: context.mdOrder,
    formUrl: context.formUrl,
    rawDeeplink: context.rawDeeplink,
    href: context.href,
    extractionJson: context.extractionJson
  });
}

function isPaymentFlowUrl(url: string): boolean {
  return /\/purchase\/ppd\b|payecom\.ru\/pay(?:_ru)?|platiecom\.ru\/deeplink/i.test(
    url
  );
}

export function withPaymentHint(
  state: PageStateSummary,
  hint: string | null
): PageStateSummary {
  if (!hint || state.urlHints.includes(hint)) {
    return state;
  }

  const nextState = {
    ...state,
    urlHints: [...state.urlHints, hint]
  };

  return {
    ...nextState,
    paymentContext: extractPaymentContext(nextState)
  };
}

export function shouldCapturePaymentGatewayUrl(
  payload: SessionActionPayload,
  before: PageStateSummary
): boolean {
  if (payload.action !== 'click') {
    return false;
  }

  if (
    !/\/purchase\/ppd\b/i.test(before.url) &&
    before.paymentContext.phase !== 'litres_checkout'
  ) {
    return false;
  }

  if (
    before.paymentContext.terminalExtractionResult ||
    before.paymentContext.paymentOrderId
  ) {
    return false;
  }

  const selector = 'selector' in payload ? (payload.selector ?? '') : '';
  const targetName = 'name' in payload ? normalize(payload.name) : '';
  const targetText = 'text' in payload ? normalize(payload.text) : '';
  const targetBlob = `${selector} ${targetName} ${targetText}`.toLowerCase();

  return /paymentlayout__payment--button|продолжить|sber|сбер|сбп|российская карта/.test(
    targetBlob
  );
}

async function capturePaymentGatewayUrlDuringClick(
  session: BrowserSession,
  clickAction: () => Promise<void>
): Promise<string | null> {
  const page = session.page();
  let capturedUrl: string | null = null;

  const rememberUrl = (url: string): void => {
    if (!capturedUrl && PAYMENT_GATEWAY_URL_PATTERN.test(url)) {
      capturedUrl = url;
    }
  };

  const routeHandler = async (route: Route): Promise<void> => {
    const requestUrl = route.request().url();
    rememberUrl(requestUrl);
    if (PAYMENT_GATEWAY_URL_PATTERN.test(requestUrl)) {
      await route.abort('aborted');
      return;
    }
    await route.continue();
  };
  const requestHandler = (request: Request): void => rememberUrl(request.url());
  const frameHandler = (frame: Frame): void => rememberUrl(frame.url());

  await page.route(PAYMENT_GATEWAY_URL_PATTERN, routeHandler);
  page.on('request', requestHandler);
  page.on('framenavigated', frameHandler);
  try {
    await clickAction();
    await Promise.race([
      page
        .waitForRequest(
          (request) => PAYMENT_GATEWAY_URL_PATTERN.test(request.url()),
          { timeout: 1_000 }
        )
        .then((request) => {
          rememberUrl(request.url());
        }),
      new Promise((resolve) => setTimeout(resolve, 1_000))
    ]);
  } catch (error) {
    if (!capturedUrl) {
      throw error;
    }
  } finally {
    page.off('request', requestHandler);
    page.off('framenavigated', frameHandler);
    await page
      .unroute(PAYMENT_GATEWAY_URL_PATTERN, routeHandler)
      .catch(() => undefined);
  }

  return capturedUrl;
}

function shouldStabilizeForPaymentFlow(
  payload: SessionActionPayload,
  before: PageStateSummary,
  after: PageStateSummary
): boolean {
  if (payload.action !== 'click' && payload.action !== 'navigate') {
    return false;
  }

  const selector = 'selector' in payload ? (payload.selector ?? '') : '';
  const targetName = 'name' in payload ? normalize(payload.name) : '';
  const targetText = 'text' in payload ? normalize(payload.text) : '';
  const targetBlob = `${selector} ${targetName} ${targetText}`.toLowerCase();

  if (
    /paymentlayout__payment--button|sbid-button|перейти к покупке|продолжить|сбер id|sber id/.test(
      targetBlob
    )
  ) {
    return true;
  }

  return (
    isPaymentFlowUrl(before.url) ||
    isPaymentFlowUrl(after.url) ||
    before.paymentContext.detected ||
    after.paymentContext.detected ||
    before.paymentContext.phase === 'litres_checkout' ||
    after.paymentContext.phase === 'litres_checkout' ||
    before.paymentContext.phase === 'payecom_boundary' ||
    after.paymentContext.phase === 'payecom_boundary'
  );
}

async function stabilizeAfterPaymentAction(
  session: BrowserSession,
  payload: SessionActionPayload,
  before: PageStateSummary,
  initialAfter: PageStateSummary,
  paymentGatewayHint: string | null = null
): Promise<PageStateSummary> {
  if (!shouldStabilizeForPaymentFlow(payload, before, initialAfter)) {
    return initialAfter;
  }

  let best = initialAfter;
  const initialFingerprint = paymentFingerprint(initialAfter.paymentContext);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const current = withPaymentHint(
      await session.observe(),
      paymentGatewayHint
    );

    const paymentChanged =
      paymentFingerprint(current.paymentContext) !== initialFingerprint;
    const urlHintsChanged =
      current.urlHints.join('\n') !== best.urlHints.join('\n');
    const textsChanged =
      current.visibleTexts.join('\n') !== best.visibleTexts.join('\n');
    const buttonsChanged =
      current.visibleButtons
        .map((button) => `${button.text}|${button.ariaLabel ?? ''}`)
        .join('\n') !==
      best.visibleButtons
        .map((button) => `${button.text}|${button.ariaLabel ?? ''}`)
        .join('\n');

    if (
      paymentChanged ||
      urlHintsChanged ||
      textsChanged ||
      buttonsChanged ||
      current.url !== best.url ||
      current.title !== best.title
    ) {
      best = current;
    }

    if (
      current.paymentContext.shouldReportImmediately ||
      current.paymentContext.phase === 'payecom_boundary' ||
      current.visibleTexts.some((text) =>
        /войти по сбер id|номер карты|cvc|cvv|месяц\/год|оплатить/i.test(text)
      ) ||
      current.urlHints.some((hint) =>
        /payecom\.ru\/pay(?:_ru)?|id\.sber\.ru/i.test(hint)
      )
    ) {
      best = current;
      break;
    }
  }

  return best;
}

export async function runStep(
  session: BrowserSession,
  payload: SessionActionPayload
): Promise<{
  before: PageStateSummary;
  after: PageStateSummary;
  observations: ActionObservationSummary[];
}> {
  const before = await session.observe();
  let capturedPaymentGatewayUrl: string | null = null;
  const modalObservations: Array<ActionObservationSummary | null> = [];

  if (payload.action === 'navigate') {
    await withRetry(async () => {
      await session.page().goto(payload.url, {
        waitUntil: 'domcontentloaded',
        timeout: payload.timeoutMs ?? 15_000
      });
      await session.waitForInitialLoad();
    });
  } else if (payload.action === 'wait_for') {
    if (payload.selector) {
      await session.page().waitForSelector(payload.selector, {
        state: payload.state ?? 'visible',
        timeout: payload.timeoutMs ?? 5_000
      });
    } else if (payload.text) {
      await session
        .page()
        .getByText(payload.text, { exact: payload.exact ?? false })
        .first()
        .waitFor({
          state: payload.state ?? 'visible',
          timeout: payload.timeoutMs ?? 5_000
        });
    } else if (payload.role) {
      await session
        .page()
        .getByRole(
          payload.role as never,
          payload.name ? { name: payload.name } : undefined
        )
        .first()
        .waitFor({
          state: payload.state ?? 'visible',
          timeout: payload.timeoutMs ?? 5_000
        });
    } else {
      throw new BrowserPlatformError(
        'wait_for requires selector, text, or role',
        { code: 'ACTION_TARGET_REQUIRED' }
      );
    }
  } else {
    const locator = await resolveLocator(session, payload);

    if (payload.action === 'click') {
      const clickAction = async () => {
        // Первый клик остается fast path. Если его блокирует модалка, catch
        // может закрыть ее и потратить один слот retry-бюджета.
        for (
          let attempt = 0;
          attempt <= MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS;
          attempt += 1
        ) {
          try {
            await locator.click({ timeout: payload.timeoutMs ?? 5_000 });
            await waitForNavigationSettled(session);
            if (attempt > 0) {
              modalObservations.push({
                level: 'info',
                code: 'CLICK_RETRIED_AFTER_MODAL_DISMISS',
                message: 'Click completed after dismissing a blocking modal.'
              });
            }
            return;
          } catch (error) {
            if (attempt >= MAX_CLICK_RETRIES_AFTER_MODAL_DISMISS) {
              throw error;
            }

            const blocker = await describePointBlocker(locator);
            const dismissResult = await dismissBlockingModals(session, blocker);
            if (dismissResult.status !== 'none') {
              modalObservations.push({
                level: 'warning',
                code: 'BLOCKING_MODAL_DETECTED',
                message: blocker
                  ? `Click target was blocked by ${blocker}.`
                  : 'Click target was blocked by a modal.'
              });
              modalObservations.push(buildModalObservation(dismissResult));
            }

            if (dismissResult.status !== 'dismissed') {
              throw error;
            }
          }
        }
      };

      if (shouldCapturePaymentGatewayUrl(payload, before)) {
        capturedPaymentGatewayUrl = await capturePaymentGatewayUrlDuringClick(
          session,
          clickAction
        );
      } else {
        await clickAction();
      }
    }

    if (payload.action === 'fill') {
      await locator.fill(payload.value, {
        timeout: payload.timeoutMs ?? 5_000
      });
    }

    if (payload.action === 'type') {
      if (payload.clearFirst) {
        await locator.fill('', { timeout: payload.timeoutMs ?? 5_000 });
      }
      await locator.type(payload.value, {
        delay: payload.delayMs ?? 20,
        timeout: payload.timeoutMs ?? 5_000
      });
    }

    if (payload.action === 'press') {
      await locator.press(payload.key, {
        delay: payload.delayMs ?? 0,
        timeout: payload.timeoutMs ?? 5_000
      });
      await waitForNavigationSettled(session);
    }
  }

  const observedAfter = withPaymentHint(
    await session.observe(),
    capturedPaymentGatewayUrl
  );
  const after = await stabilizeAfterPaymentAction(
    session,
    payload,
    before,
    observedAfter,
    capturedPaymentGatewayUrl
  );
  return { before, after, observations: uniqueObservations(modalObservations) };
}

export function buildActionResult(
  payload: SessionActionPayload,
  before: PageStateSummary,
  after: PageStateSummary,
  extraObservations: ActionObservationSummary[] = []
) {
  return {
    action: payload.action,
    target: {
      selector: 'selector' in payload ? (payload.selector ?? null) : null,
      role: 'role' in payload ? (payload.role ?? null) : null,
      name: 'name' in payload ? normalize(payload.name) || null : null,
      text: 'text' in payload ? normalize(payload.text) || null : null
    },
    input: {
      value: 'value' in payload ? payload.value : null,
      url: 'url' in payload ? payload.url : null,
      key: 'key' in payload ? payload.key : null
    },
    before,
    after,
    changes: buildActionDiff(before, after),
    observations: [
      ...extraObservations,
      ...buildPostActionObservations(before, after)
    ]
  };
}
