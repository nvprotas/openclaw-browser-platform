import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const waitForInitialLoadMock = vi.fn(async () => undefined);

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill() {
    this.killed = true;
    this.emit('exit', 0, 'SIGTERM');
    return true;
  }
}

const spawnMock = vi.fn(() => new FakeProcess());

const page = {
  goto: vi.fn(async () => undefined),
  url: vi.fn(() => 'https://example.com/'),
  title: vi.fn(async () => 'Example'),
  viewportSize: vi.fn(() => ({ width: 1440, height: 900 }))
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

vi.mock('playwright', () => ({
  chromium: { launch: chromiumLaunchMock },
  firefox: { connect: firefoxConnectMock }
}));

vi.mock('../../src/playwright/waits.js', () => ({
  waitForInitialLoad: waitForInitialLoadMock
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('camoufox backend', () => {
  it('uses chromium launch by default', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's1',
      snapshotRootDir: '/tmp/snapshots'
    });

    const opened = await session.open('https://example.com');
    expect(opened).toMatchObject({ url: 'https://example.com/', title: 'Example' });
    expect(chromiumLaunchMock).toHaveBeenCalledTimes(1);
    expect(firefoxConnectMock).not.toHaveBeenCalled();
  });

  it('starts camoufox server and connects via firefox websocket', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's2',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const proc = spawnMock.mock.results[0]?.value as FakeProcess | undefined;
    setTimeout(() => {
      (proc ?? spawnMock.mock.results[0].value as FakeProcess).stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    }, 5);

    await session.open('https://example.com');

    expect(spawnMock).toHaveBeenCalledWith('python', ['-m', 'camoufox', 'server'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    expect(firefoxConnectMock).toHaveBeenCalledWith('ws://127.0.0.1:9222', expect.any(Object));
    expect(chromiumLaunchMock).not.toHaveBeenCalled();
  });

  it('extracts ws endpoint from noisy log lines', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    expect(mod.extractWebsocketEndpoint('INFO :: websocket at ws://127.0.0.1:9333/path')).toBe('ws://127.0.0.1:9333/path');
    expect(mod.extractWebsocketEndpoint('ready: wss://host.example/ws?token=abc')).toBe('wss://host.example/ws?token=abc');
    expect(mod.extractWebsocketEndpoint('no endpoint here')).toBeNull();
  });
});
