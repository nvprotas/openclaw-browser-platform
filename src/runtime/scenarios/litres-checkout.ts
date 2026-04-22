import type {
  ActionDiffSummary,
  ActionObservationSummary,
  ClickActionPayload,
  ScenarioStage,
  SessionActionPayload,
  SessionObservation,
  SessionRunScenarioResponse
} from '../../daemon/types.js';
import { buildHardStopSignal } from '../../helpers/hard-stop.js';
import {
  findAddToCartTargets,
  findOpenCartTargets,
  isAddToCartConfirmed,
  is404LikePage,
  isCartVisible
} from '../../helpers/cart.js';
import { chooseSearchResultTarget } from '../../helpers/search.js';
import type { LoadedSitePack } from '../../packs/loader.js';
import type { PageStateSummary } from '../../playwright/browser-session.js';

export interface ScenarioController {
  observeSession(sessionId: string): Promise<PageStateSummary>;
  actInSession(
    sessionId: string,
    payload: SessionActionPayload,
    options?: { sitePack?: LoadedSitePack | null }
  ): Promise<ScenarioActionResult>;
}

export interface ScenarioActionResult {
  before: PageStateSummary;
  after: PageStateSummary;
  changes: ActionDiffSummary;
  observations: ActionObservationSummary[];
}

export interface LitresCheckoutScenarioInput {
  controller: ScenarioController;
  sessionId: string;
  pack: LoadedSitePack | null;
  query: string;
  maxDurationMs?: number;
}

function isoNow(): string {
  return new Date().toISOString();
}

function toObservation(
  sessionId: string,
  state: PageStateSummary
): SessionObservation {
  const hardStop = buildHardStopSignal(state.url, state.paymentContext);
  return {
    sessionId,
    observedAt: isoNow(),
    ...state,
    hardStop: hardStop ?? undefined
  };
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

function checkoutProceedTargets(
  pack: LoadedSitePack | null
): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'checkout_proceed');
  const buttonTexts = [
    ...readPackStrings(pack, 'button_texts', 'checkout_proceed'),
    'Перейти к покупке',
    'Оформить заказ'
  ];

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

function checkoutContinueTargets(
  pack: LoadedSitePack | null
): ClickActionPayload[] {
  const selectors = readPackStrings(pack, 'selectors', 'checkout_continue');
  const buttonTexts = [
    'Продолжить',
    ...readPackStrings(pack, 'button_texts', 'checkout_continue')
  ];

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

function checkoutRussianCardTargets(
  pack: LoadedSitePack | null
): ClickActionPayload[] {
  const selectors = [
    ...readPackStrings(pack, 'selectors', 'checkout_russian_card'),
    "label[for='payment-method-input_russian_card']",
    "label[for='payment-method-input-russian_card']"
  ];
  const buttonTexts = ['Российская карта'];

  return unique([
    ...selectors.map<ClickActionPayload>((selector) => ({
      action: 'click',
      selector
    })),
    ...buttonTexts.map<ClickActionPayload>((name) => ({
      action: 'click',
      role: 'radio',
      name
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

function shouldSwitchFromSbp(state: PageStateSummary): boolean {
  const hints = [state.url, ...state.urlHints].join(' ');
  return (
    state.paymentContext.paymentMethod === 'sbp' ||
    state.paymentContext.paymentSystem === 'sbersbp' ||
    /[?&]method=sbp\b|[?&]system=sbersbp\b/i.test(hints)
  );
}

function rewriteCheckoutToRussianCard(url: string): string | null {
  try {
    const next = new URL(url);
    next.searchParams.set('method', 'russian_card');
    next.searchParams.set('system', 'sbercard');
    return next.toString();
  } catch {
    return null;
  }
}

export function buildLitresSearchUrl(query: string, baseUrl?: string): string {
  if (baseUrl?.trim()) {
    const url = new URL('/search/', baseUrl);
    url.searchParams.set('q', query);
    return url.toString();
  }

  return `https://www.litres.ru/search/?q=${encodeURIComponent(query)}`;
}

export async function runLitresCheckoutScenario(
  input: LitresCheckoutScenarioInput
): Promise<SessionRunScenarioResponse> {
  const stages: ScenarioStage[] = [];
  const startedMs = Date.now();
  const maxDurationMs = input.maxDurationMs ?? 60_000;
  let lastObservation: PageStateSummary | null = null;

  const ensureBudget = (): void => {
    if (Date.now() - startedMs > maxDurationMs) {
      throw new Error(`Scenario timeout after ${maxDurationMs}ms`);
    }
  };

  const stage = async <T>(
    step: string,
    fn: () => Promise<T>,
    detail: string | null = null
  ): Promise<T> => {
    ensureBudget();
    const stageStartedAt = isoNow();
    const stageStartedMs = Date.now();
    try {
      const result = await fn();
      stages.push({
        step,
        startedAt: stageStartedAt,
        finishedAt: isoNow(),
        durationMs: Date.now() - stageStartedMs,
        status: 'ok',
        detail
      });
      return result;
    } catch (error) {
      stages.push({
        step,
        startedAt: stageStartedAt,
        finishedAt: isoNow(),
        durationMs: Date.now() - stageStartedMs,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };

  const observe = async (step: string): Promise<PageStateSummary> => {
    const observed = await stage(step, () =>
      input.controller.observeSession(input.sessionId)
    );
    lastObservation = observed;
    return observed;
  };

  const runFirstSuccessfulAction = async (
    step: string,
    targets: ClickActionPayload[],
    predicate: (action: ScenarioActionResult) => boolean
  ): Promise<ScenarioActionResult> => {
    const errors: string[] = [];
    for (const [index, target] of targets.entries()) {
      ensureBudget();
      try {
        const action = await stage(
          `${step}_${index + 1}`,
          () =>
            input.controller.actInSession(input.sessionId, target, {
              sitePack: input.pack
            }),
          JSON.stringify(target)
        );
        lastObservation = action.after;
        if (!is404LikePage(action.after) && predicate(action)) {
          return action;
        }
        errors.push(`target ${index + 1} did not satisfy success predicate`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(`${step} failed: ${errors.join('; ')}`);
  };

  try {
    let observed = await observe('observe_search_results');
    const resultTarget = chooseSearchResultTarget(observed, input.query);
    if (!resultTarget) {
      throw new Error('Search result target was not found');
    }

    const product = await stage(
      'open_first_search_result',
      () =>
        input.controller.actInSession(input.sessionId, resultTarget, {
          sitePack: input.pack
        }),
      JSON.stringify(resultTarget)
    );
    lastObservation = product.after;

    await runFirstSuccessfulAction(
      'add_to_cart',
      findAddToCartTargets(input.pack),
      (action) => isAddToCartConfirmed(action)
    );
    await runFirstSuccessfulAction(
      'open_cart',
      findOpenCartTargets(input.pack),
      (action) => isCartVisible(action.after)
    );
    const checkout = await runFirstSuccessfulAction(
      'checkout_proceed',
      checkoutProceedTargets(input.pack),
      (action) =>
        /\/purchase\/ppd\b/i.test(action.after.url) ||
        action.after.paymentContext.phase === 'litres_checkout'
    );

    observed = checkout.after;
    if (shouldSwitchFromSbp(observed)) {
      const targetUrl = rewriteCheckoutToRussianCard(observed.url);
      if (!targetUrl) {
        throw new Error(
          'Unable to rewrite checkout URL to russian_card/sbercard'
        );
      }
      const switched = await stage('switch_from_sbp_to_sbercard', () =>
        input.controller.actInSession(
          input.sessionId,
          {
            action: 'navigate',
            url: targetUrl
          },
          {
            sitePack: input.pack
          }
        )
      );
      observed = switched.after;
      lastObservation = observed;
    }

    if (shouldSwitchFromSbp(observed)) {
      const switched = await runFirstSuccessfulAction(
        'switch_from_sbp_to_sbercard_ui',
        checkoutRussianCardTargets(input.pack),
        (action) => !shouldSwitchFromSbp(action.after)
      );
      observed = switched.after;
    }

    const continueAction = await runFirstSuccessfulAction(
      'checkout_continue',
      checkoutContinueTargets(input.pack),
      (action) =>
        Boolean(
          buildHardStopSignal(action.after.url, action.after.paymentContext)
        ) ||
        action.after.paymentContext.phase === 'payecom_boundary' ||
        action.after.paymentContext.detected
    );
    observed = continueAction.after;

    while (Date.now() - startedMs <= maxDurationMs) {
      const hardStop = buildHardStopSignal(
        observed.url,
        observed.paymentContext
      );
      if (hardStop) {
        return {
          ok: true,
          sessionId: input.sessionId,
          hardStop,
          finalPayload: hardStop.finalPayload,
          stages
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      observed = await observe('poll_hard_stop');
    }

    throw new Error(`Scenario timeout after ${maxDurationMs}ms`);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      sessionId: input.sessionId,
      lastObservation: lastObservation
        ? toObservation(input.sessionId, lastObservation)
        : undefined,
      stages
    };
  }
}
