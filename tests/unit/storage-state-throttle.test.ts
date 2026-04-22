import { describe, expect, it, vi } from 'vitest';
import { BrowserSession } from '../../src/playwright/browser-session.js';

describe('BrowserSession storage-state throttle', () => {
  it('throttles repeated storage writes and forces a final write on close', async () => {
    const storageState = vi.fn(async () => undefined);
    const session = new BrowserSession({
      sessionId: 'storage-throttle',
      snapshotRootDir: '/tmp/browser-platform-test',
      storageStatePath: '/tmp/browser-platform-test/storage-state.json',
      backend: 'chromium'
    });

    session.adoptExisting({
      browser: { close: vi.fn(async () => undefined) } as never,
      context: {
        storageState,
        close: vi.fn(async () => undefined)
      } as never,
      page: {
        close: vi.fn(async () => undefined)
      } as never,
      stop: vi.fn(async () => undefined)
    });

    await session.persistStorageState();
    await session.persistStorageState();

    expect(storageState).toHaveBeenCalledTimes(1);

    await session.close();

    expect(storageState).toHaveBeenCalledTimes(2);
  });
});
