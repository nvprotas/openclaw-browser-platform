import { describe, expect, it, vi } from 'vitest';
import { PlaywrightController } from '../../src/playwright/controller.js';
import type { PageStateSummary } from '../../src/playwright/browser-session.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createPageState(tag: string): PageStateSummary {
  return {
    url: `https://example.com/${tag}`,
    title: `title-${tag}`,
    readyState: 'complete',
    viewport: { width: 1280, height: 720 },
    visibleTexts: [],
    visibleButtons: [],
    forms: [],
    urlHints: [],
    pageSignatureGuess: 'content_page',
    paymentContext: {
      detected: false,
      shouldReportImmediately: false,
      terminalExtractionResult: false,
      provider: null,
      phase: null,
      paymentMethod: null,
      paymentSystem: null,
      paymentUrl: null,
      paymentOrderId: null,
      litresOrder: null,
      traceId: null,
      bankInvoiceId: null,
      merchantOrderNumber: null,
      merchantOrderId: null,
      mdOrder: null,
      formUrl: null,
      rawDeeplink: null,
      href: null,
      urlHints: [],
      paymentIntents: [],
      extractionJson: null
    }
  };
}

function registerMockSession(
  controller: PlaywrightController,
  sessionId: string,
  overrides: Partial<{
    markUsed: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    persistStorageState: ReturnType<typeof vi.fn>;
    page: ReturnType<typeof vi.fn>;
  }> = {}
) {
  const session = {
    markUsed: vi.fn(),
    observe: vi.fn(async () => createPageState('default')),
    snapshot: vi.fn(async () => ({
      rootDir: '/tmp/browser-platform-test',
      screenshotPath: '/tmp/browser-platform-test/page.png',
      htmlPath: '/tmp/browser-platform-test/page.html',
      state: createPageState('snapshot')
    })),
    close: vi.fn(async () => undefined),
    persistStorageState: vi.fn(async () => undefined),
    page: vi.fn(() => ({}) as never),
    ...overrides
  };

  const sessions = (controller as unknown as { sessions: Map<string, unknown> }).sessions;
  sessions.set(sessionId, session);
  return session;
}

describe('playwright controller', () => {
  it('serializes concurrent operations for one session', async () => {
    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const firstObserve = createDeferred<PageStateSummary>();
    const events: string[] = [];

    const session = registerMockSession(controller, 'session-queue', {
      observe: vi.fn(async () => {
        if (events.length === 0) {
          events.push('observe-1-start');
          const state = await firstObserve.promise;
          events.push('observe-1-end');
          return state;
        }

        events.push('observe-2-start');
        events.push('observe-2-end');
        return createPageState('second');
      })
    });

    const firstPromise = controller.observeSession('session-queue');
    await Promise.resolve();
    const secondPromise = controller.observeSession('session-queue');
    await Promise.resolve();

    expect(events).toEqual(['observe-1-start']);

    firstObserve.resolve(createPageState('first'));

    await expect(firstPromise).resolves.toMatchObject({ url: 'https://example.com/first' });
    await expect(secondPromise).resolves.toMatchObject({ url: 'https://example.com/second' });
    expect(events).toEqual(['observe-1-start', 'observe-1-end', 'observe-2-start', 'observe-2-end']);
    expect(session.observe).toHaveBeenCalledTimes(2);
  });

  it('continues processing queued operations after an error', async () => {
    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const unblockFirst = createDeferred<void>();
    let observeCall = 0;

    const session = registerMockSession(controller, 'session-error-queue', {
      observe: vi.fn(async () => {
        observeCall += 1;
        if (observeCall === 1) {
          await unblockFirst.promise;
          throw new Error('observe failed');
        }

        return createPageState('after-error');
      })
    });

    const firstPromise = controller.observeSession('session-error-queue');
    await Promise.resolve();
    const secondPromise = controller.observeSession('session-error-queue');

    unblockFirst.resolve();

    await expect(firstPromise).rejects.toThrow('observe failed');
    await expect(secondPromise).resolves.toMatchObject({ url: 'https://example.com/after-error' });
    expect(session.observe).toHaveBeenCalledTimes(2);
  });

  it('queues close after active operation on the same session', async () => {
    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const observeGate = createDeferred<PageStateSummary>();
    const closeGate = createDeferred<void>();
    const events: string[] = [];

    registerMockSession(controller, 'session-close-queue', {
      observe: vi.fn(async () => {
        events.push('observe-start');
        const state = await observeGate.promise;
        events.push('observe-end');
        return state;
      }),
      close: vi.fn(async () => {
        events.push('close-start');
        await closeGate.promise;
      })
    });

    const observePromise = controller.observeSession('session-close-queue');
    await Promise.resolve();
    const closePromise = controller.closeSession('session-close-queue').then(() => {
      events.push('close-end');
    });
    await Promise.resolve();

    expect(events).toEqual(['observe-start']);
    expect(controller.hasSession('session-close-queue')).toBe(true);

    observeGate.resolve(createPageState('observe-finished'));
    await observePromise;
    await Promise.resolve();

    expect(events).toEqual(['observe-start', 'observe-end', 'close-start']);
    expect(controller.hasSession('session-close-queue')).toBe(false);

    closeGate.resolve();
    await closePromise;
    expect(events).toEqual(['observe-start', 'observe-end', 'close-start', 'close-end']);
  });

  it('does not block operations across different sessions', async () => {
    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const firstGate = createDeferred<PageStateSummary>();
    const secondGate = createDeferred<PageStateSummary>();
    const started: string[] = [];

    registerMockSession(controller, 'session-a', {
      observe: vi.fn(async () => {
        started.push('session-a');
        return firstGate.promise;
      })
    });
    registerMockSession(controller, 'session-b', {
      observe: vi.fn(async () => {
        started.push('session-b');
        return secondGate.promise;
      })
    });

    const firstPromise = controller.observeSession('session-a');
    const secondPromise = controller.observeSession('session-b');
    await Promise.resolve();
    await Promise.resolve();

    expect(started.sort()).toEqual(['session-a', 'session-b']);

    firstGate.resolve(createPageState('session-a'));
    secondGate.resolve(createPageState('session-b'));
    await Promise.all([firstPromise, secondPromise]);
  });

  it('adopts an externally bootstrapped session and closes it cleanly', async () => {
    const page = {
      url: vi.fn(() => 'https://id.sber.ru/auth'),
      title: vi.fn(async () => 'Sber ID'),
      close: vi.fn(async () => undefined)
    };
    const context = {
      storageState: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
    const browser = {
      close: vi.fn(async () => undefined)
    };
    const stop = vi.fn(async () => undefined);

    const controller = new PlaywrightController('/tmp/browser-platform-test');
    const opened = await controller.adoptSession(
      'session-1',
      {
        browser: browser as never,
        context: context as never,
        page: page as never,
        stop
      },
      {
        storageStatePath: '/tmp/browser-platform-test/storage-state.json',
        backend: 'camoufox'
      }
    );

    expect(opened).toMatchObject({
      url: 'https://id.sber.ru/auth',
      title: 'Sber ID'
    });
    expect(context.storageState).toHaveBeenCalledWith({ path: '/tmp/browser-platform-test/storage-state.json' });

    await controller.closeSession('session-1');

    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('closeAll closes every tracked session and is safe to repeat', async () => {
    const createAdopted = (id: string) => {
      const page = {
        url: vi.fn(() => `https://example.com/${id}`),
        title: vi.fn(async () => id),
        close: vi.fn(async () => undefined)
      };
      const context = {
        storageState: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined)
      };
      const browser = {
        close: vi.fn(async () => undefined)
      };
      const stopBarrier = createDeferred<void>();
      const stop = vi.fn(async () => {
        await stopBarrier.promise;
      });

      return { page, context, browser, stop, stopBarrier };
    };

    const first = createAdopted('first');
    const second = createAdopted('second');
    const controller = new PlaywrightController('/tmp/browser-platform-test');

    await controller.adoptSession(
      'session-1',
      {
        browser: first.browser as never,
        context: first.context as never,
        page: first.page as never,
        stop: first.stop
      },
      { backend: 'camoufox' }
    );
    await controller.adoptSession(
      'session-2',
      {
        browser: second.browser as never,
        context: second.context as never,
        page: second.page as never,
        stop: second.stop
      },
      { backend: 'camoufox' }
    );

    let closed = false;
    const closeAllPromise = controller.closeAll().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    first.stopBarrier.resolve();
    second.stopBarrier.resolve();
    await closeAllPromise;
    await controller.closeAll();

    expect(first.page.close).toHaveBeenCalledTimes(1);
    expect(first.context.close).toHaveBeenCalledTimes(1);
    expect(first.browser.close).toHaveBeenCalledTimes(1);
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.page.close).toHaveBeenCalledTimes(1);
    expect(second.context.close).toHaveBeenCalledTimes(1);
    expect(second.browser.close).toHaveBeenCalledTimes(1);
    expect(second.stop).toHaveBeenCalledTimes(1);
    expect(controller.hasSession('session-1')).toBe(false);
    expect(controller.hasSession('session-2')).toBe(false);
  });

  it('cleans up adopted wrapper resources if adopt session fails before registration', async () => {
    const page = {
      url: vi.fn(() => 'https://id.sber.ru/auth'),
      title: vi.fn(async () => 'Sber ID'),
      close: vi.fn(async () => undefined)
    };
    const context = {
      storageState: vi.fn(async () => {
        throw new Error('persist failed');
      }),
      close: vi.fn(async () => undefined)
    };
    const browser = {
      close: vi.fn(async () => undefined)
    };
    const stop = vi.fn(async () => undefined);

    const controller = new PlaywrightController('/tmp/browser-platform-test');

    await expect(
      controller.adoptSession(
        'session-failed',
        {
          browser: browser as never,
          context: context as never,
          page: page as never,
          stop
        },
        {
          storageStatePath: '/tmp/browser-platform-test/storage-state.json',
          backend: 'camoufox'
        }
      )
    ).rejects.toThrow('persist failed');

    expect(page.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(controller.hasSession('session-failed')).toBe(false);
  });
});
