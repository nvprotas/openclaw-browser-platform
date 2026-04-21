import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn(() => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume?: () => void };
    stderr: EventEmitter & { resume?: () => void };
    kill: () => boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  proc.stdout = new EventEmitter();
  proc.stdout.resume = vi.fn();
  proc.stderr = new EventEmitter();
  proc.stderr.resume = vi.fn();
  proc.kill = vi.fn(() => true);
  proc.exitCode = null;
  proc.signalCode = null;
  return proc;
});

const page = {
  goto: vi.fn(async () => undefined),
  url: vi.fn(() => 'https://example.com/'),
  title: vi.fn(async () => 'Example'),
  viewportSize: vi.fn(() => ({ width: 1440, height: 900 })),
  close: vi.fn(async () => undefined)
};

const context = {
  newPage: vi.fn(async () => page),
  storageState: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined)
};

const browser = {
  newContext: vi.fn(async () => context),
  close: vi.fn(async () => undefined)
};

const chromiumLaunchMock = vi.fn(async () => browser);
const firefoxConnectMock = vi.fn(async () => browser);

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true)
}));

vi.mock('playwright', () => ({
  chromium: { launch: chromiumLaunchMock },
  firefox: { connect: firefoxConnectMock }
}));

vi.mock('../../src/playwright/waits.js', () => ({
  waitForInitialLoad: vi.fn(async () => undefined)
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('chromium backend', () => {
  it('launches chromium and does not spawn camoufox process', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 'chromium-1',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'chromium'
    });

    const opened = await session.open('https://example.com');

    expect(opened).toMatchObject({ url: 'https://example.com/', title: 'Example' });
    expect(chromiumLaunchMock).toHaveBeenCalledTimes(1);
    expect(firefoxConnectMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
