import { describe, expect, it, vi } from 'vitest';
import { PlaywrightController } from '../../src/playwright/controller.js';

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
    const stop = vi.fn();

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
});
