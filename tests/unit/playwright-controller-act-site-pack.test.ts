import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionActionPayload } from '../../src/daemon/types.js';
import { createEmptyPaymentContext } from '../../src/helpers/payment-context.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';

function state(tag: string): PageStateSummary {
  return {
    url: `https://brandshop.ru/${tag}`,
    title: tag,
    readyState: 'complete',
    viewport: { width: 1280, height: 720 },
    visibleTexts: [],
    visibleButtons: [],
    forms: [],
    urlHints: [],
    pageSignatureGuess: 'content_page',
    paymentContext: createEmptyPaymentContext()
  };
}

describe('playwright controller act site-pack propagation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../src/runtime/run-step.js');
  });

  it('passes the matched site-pack through to runStep', async () => {
    vi.resetModules();
    const before = state('before');
    const after = state('after');
    const runStep = vi.fn(async () => ({
      before,
      after,
      observations: []
    }));
    const buildActionResult = vi.fn(() => ({
      action: 'click',
      target: { selector: null, role: null, name: null, text: 'Принять' },
      input: { value: null, url: null, key: null },
      before,
      after,
      changes: {
        urlChanged: true,
        titleChanged: true,
        pageSignatureChanged: false,
        addedButtons: [],
        removedButtons: [],
        addedTexts: [],
        removedTexts: []
      },
      observations: []
    }));

    vi.doMock('../../src/runtime/run-step.js', () => ({
      runStep,
      buildActionResult
    }));

    const { PlaywrightController } =
      await import('../../src/playwright/controller.js');
    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const session = {
      markUsed: vi.fn()
    };
    (controller as unknown as { sessions: Map<string, unknown> }).sessions.set(
      'session-1',
      session
    );
    const payload = {
      action: 'click',
      text: 'Принять'
    } satisfies SessionActionPayload;
    const sitePack = {
      summary: { siteId: 'brandshop' },
      pack: { hints: { raw: { cookie_consent: { selectors: ['#accept'] } } } }
    };

    await controller.actInSession('session-1', payload, {
      sitePack: sitePack as never
    });

    expect(runStep).toHaveBeenCalledWith(
      session,
      payload,
      expect.objectContaining({
        sitePack
      })
    );
  });
});
