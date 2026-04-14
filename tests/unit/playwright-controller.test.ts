import { describe, expect, it, vi } from 'vitest';
import { PlaywrightController } from '../../src/playwright/controller.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('playwright controller', () => {
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
