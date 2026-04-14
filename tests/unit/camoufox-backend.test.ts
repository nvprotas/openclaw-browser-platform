import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const waitForInitialLoadMock = vi.fn(async () => undefined);

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter() as EventEmitter & { resume?: () => void };
  stderr = new EventEmitter() as EventEmitter & { resume?: () => void };
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  exitOnTerm = true;
  killSignals: NodeJS.Signals[] = [];

  constructor() {
    super();
    this.stdout.resume = vi.fn();
    this.stderr.resume = vi.fn();
  }

  finish(code: number | null, signal: NodeJS.Signals | null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.killed = true;
    this.killSignals.push(signal);
    if (signal === 'SIGTERM' && this.exitOnTerm) {
      this.finish(null, 'SIGTERM');
    }
    if (signal === 'SIGKILL') {
      this.finish(null, 'SIGKILL');
    }
    return true;
  }
}

let latestProc: FakeProcess | undefined;
const spawnMock = vi.fn(() => {
  latestProc = new FakeProcess();
  return latestProc;
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

const firefoxConnectMock = vi.fn(async () => browser);

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => path.endsWith('/python'))
}));

vi.mock('playwright', () => ({
  firefox: { connect: firefoxConnectMock }
}));

vi.mock('../../src/playwright/waits.js', () => ({
  waitForInitialLoad: waitForInitialLoadMock
}));

afterEach(() => {
  vi.clearAllMocks();
  latestProc = undefined;
  delete process.env.CAMOUFOX_PYTHON_BIN;
  vi.useRealTimers();
});

describe('camoufox backend', () => {
  it('uses camoufox by default', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's1',
      snapshotRootDir: '/tmp/snapshots'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    const opened = await openPromise;

    expect(opened).toMatchObject({ url: 'https://example.com/', title: 'Example' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(firefoxConnectMock).toHaveBeenCalledTimes(1);
  });

  it('starts camoufox server and connects via firefox websocket', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's2',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const originalBin = process.env.CAMOUFOX_PYTHON_BIN;
    process.env.CAMOUFOX_PYTHON_BIN = 'python';

    try {
      // spawn is called synchronously inside open(), so capture after open() starts
      const openPromise = session.open('https://example.com');
      // yield to let spawn() execute before emitting data
      await Promise.resolve();
      latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
      await openPromise;
    } finally {
      if (originalBin === undefined) {
        delete process.env.CAMOUFOX_PYTHON_BIN;
      } else {
        process.env.CAMOUFOX_PYTHON_BIN = originalBin;
      }
    }

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const firstSpawnCall = spawnMock.mock.calls[0] as unknown as [string, string[], { stdio: string[] }];
    expect(firstSpawnCall[0]).toBe('python');
    expect(firstSpawnCall[1]).toMatchObject(['-c', expect.stringContaining('config.pop("proxy", None)')]);
    expect(firstSpawnCall[2]).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] });
    expect(firefoxConnectMock).toHaveBeenCalledWith('ws://127.0.0.1:9222', expect.any(Object));
  });

  it('uses python3 when python is missing from PATH', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's2b',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const originalPath = process.env.PATH;
    process.env.PATH = '/tmp/without-python:/tmp/with-python3';

    const fsMod = await import('node:fs');
    vi.mocked(fsMod.existsSync).mockImplementation((path) => String(path).endsWith('/python3'));

    try {
      const openPromise = session.open('https://example.com');
      await Promise.resolve();
      latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
      await openPromise;
    } finally {
      process.env.PATH = originalPath;
    }

    const firstSpawnCall = spawnMock.mock.calls[0] as unknown as [string, string[], { stdio: string[] }];
    expect(firstSpawnCall[0]).toBe('python3');
    expect(firstSpawnCall[1]).toMatchObject(['-c', expect.any(String)]);
    expect(firstSpawnCall[2]).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('uses CAMOUFOX_PYTHON_BIN when provided', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's2c',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const originalBin = process.env.CAMOUFOX_PYTHON_BIN;
    process.env.CAMOUFOX_PYTHON_BIN = 'python3.12';

    try {
      const openPromise = session.open('https://example.com');
      await Promise.resolve();
      latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
      await openPromise;
    } finally {
      if (originalBin === undefined) {
        delete process.env.CAMOUFOX_PYTHON_BIN;
      } else {
        process.env.CAMOUFOX_PYTHON_BIN = originalBin;
      }
    }

    const firstSpawnCall = spawnMock.mock.calls[0] as unknown as [string, string[], { stdio: string[] }];
    expect(firstSpawnCall[0]).toBe('python3.12');
    expect(firstSpawnCall[1]).toMatchObject(['-c', expect.any(String)]);
    expect(firstSpawnCall[2]).toEqual({ stdio: ['ignore', 'pipe', 'pipe'] });
  });

  it('drains stdout/stderr after endpoint is found', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's3',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('ws://127.0.0.1:9222\n'));
    await openPromise;

    expect(latestProc!.stdout.resume).toHaveBeenCalled();
    expect(latestProc!.stderr.resume).toHaveBeenCalled();
  });

  it('extracts ws endpoint from noisy log lines', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    expect(mod.extractWebsocketEndpoint('INFO :: websocket at ws://127.0.0.1:9333/path')).toBe('ws://127.0.0.1:9333/path');
    expect(mod.extractWebsocketEndpoint('ready: wss://host.example/ws?token=abc')).toBe('wss://host.example/ws?token=abc');
    expect(mod.extractWebsocketEndpoint('no endpoint here')).toBeNull();
  });

  it('correctly parses endpoint split across multiple chunks', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's4',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    // URL split across two chunks — no newline in first chunk
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:'));
    latestProc!.stdout.emit('data', Buffer.from('9555\n'));
    await openPromise;

    expect(firefoxConnectMock).toHaveBeenCalledWith('ws://127.0.0.1:9555', expect.any(Object));
  });

  it('rejects with timeout error if endpoint never arrives', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's5',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      camoufoxStartupTimeoutMs: 20
    });

    await expect(session.open('https://example.com')).rejects.toMatchObject({
      details: { cause: expect.stringContaining('Timed out waiting for Camoufox ws endpoint') }
    });
  });

  it('rejects with early-exit error if camoufox process exits before publishing endpoint', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's6',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    latestProc!.finish(1, null);

    await expect(openPromise).rejects.toMatchObject({
      details: { cause: expect.stringContaining('exited before publishing ws endpoint') }
    });
  });

  it('escalates to SIGKILL if camoufox ignores SIGTERM during shutdown', async () => {
    vi.useFakeTimers();
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's7',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    await openPromise;

    latestProc!.exitOnTerm = false;
    let closed = false;
    const closePromise = session.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);

    await vi.advanceTimersByTimeAsync(3_000);
    await closePromise;

    expect(latestProc!.killSignals).toContain('SIGTERM');
    expect(latestProc!.killSignals).toContain('SIGKILL');
    expect(closed).toBe(true);
  });

  it('waits for wrapper exit on firefox connect failure', async () => {
    vi.useFakeTimers();
    firefoxConnectMock.mockRejectedValueOnce(new Error('connect failed'));

    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's7b',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    let failed = false;
    const trackedOpenPromise = openPromise.then(
      () => ({ ok: true as const, error: null }),
      (error) => {
        failed = true;
        return { ok: false as const, error };
      }
    );
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    latestProc!.exitOnTerm = false;

    await Promise.resolve();
    expect(failed).toBe(false);

    await vi.advanceTimersByTimeAsync(3_000);

    const result = await trackedOpenPromise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      details: { cause: 'Camoufox started but Playwright Firefox failed to connect' }
    });
    expect(latestProc!.killSignals).toContain('SIGTERM');
    expect(latestProc!.killSignals).toContain('SIGKILL');
    expect(failed).toBe(true);
  });

  it('allows repeated session close without duplicating wrapper shutdown', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const session = new mod.BrowserSession({
      sessionId: 's7c',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox'
    });

    const openPromise = session.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    await openPromise;

    await session.close();
    await session.close();

    expect(latestProc!.killSignals).toEqual(['SIGTERM']);
  });

  it('reuses shared context for the same storage state path', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const pool = new mod.BrowserContextPool();
    const sessionA = new mod.BrowserSession({
      sessionId: 'shared-a',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/litres/storage-state.json',
      contextPool: pool
    });
    const sessionB = new mod.BrowserSession({
      sessionId: 'shared-b',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/litres/storage-state.json',
      contextPool: pool
    });

    const openA = sessionA.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    const openedA = await openA;
    const openedB = await sessionB.open('https://example.com');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(openedA.timing?.stages.some((stage) => stage.step === 'create_shared_context')).toBe(true);
    expect(openedB.timing?.stages.some((stage) => stage.step === 'reuse_shared_context')).toBe(true);

    await sessionA.close();
    await sessionB.close();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('keeps shared context alive until the last pooled session is closed', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const pool = new mod.BrowserContextPool();
    const sessionA = new mod.BrowserSession({
      sessionId: 'shared-retain-a',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/litres/storage-state.json',
      contextPool: pool
    });
    const sessionB = new mod.BrowserSession({
      sessionId: 'shared-retain-b',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/litres/storage-state.json',
      contextPool: pool
    });

    const openA = sessionA.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    await openA;
    await sessionB.open('https://example.com');

    await sessionA.close();

    expect(context.close).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();

    await sessionB.close();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('does not reuse context across different storage state paths', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const pool = new mod.BrowserContextPool();
    const sessionA = new mod.BrowserSession({
      sessionId: 'profile-a',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/litres/storage-state.json',
      contextPool: pool
    });
    const sessionB = new mod.BrowserSession({
      sessionId: 'profile-b',
      snapshotRootDir: '/tmp/snapshots',
      backend: 'camoufox',
      storageStatePath: '/tmp/kuper/storage-state.json',
      contextPool: pool
    });

    const openA = sessionA.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9222\n'));
    await openA;

    const openB = sessionB.open('https://example.com');
    await Promise.resolve();
    latestProc!.stdout.emit('data', Buffer.from('Listening on ws://127.0.0.1:9333\n'));
    await openB;

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(browser.newContext).toHaveBeenCalledTimes(2);

    await pool.closeAll();
  });
});

describe('resolveBackend (CLI)', () => {
  it('returns camoufox by default', async () => {
    const mod = await import('../../src/cli/commands/session.js');
    expect(mod.resolveBackend([])).toBe('camoufox');
    expect(mod.resolveBackend(['--url', 'https://x.com'])).toBe('camoufox');
  });

  it('returns camoufox when specified', async () => {
    const mod = await import('../../src/cli/commands/session.js');
    expect(mod.resolveBackend(['--backend', 'camoufox'])).toBe('camoufox');
  });

  it('throws INVALID_BACKEND for unknown value', async () => {
    const mod = await import('../../src/cli/commands/session.js');
    expect(() => mod.resolveBackend(['--backend', 'firefox'])).toThrow('Unsupported backend');
  });

  it('throws INVALID_BACKEND when --backend has no value', async () => {
    const mod = await import('../../src/cli/commands/session.js');
    expect(() => mod.resolveBackend(['--url', 'https://x.com', '--backend'])).toThrow('--backend requires a value');
  });
});

describe('resolveCamoufoxPythonCommand', () => {
  it('returns explicit command from env first', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    expect(mod.resolveCamoufoxPythonCommand({ CAMOUFOX_PYTHON_BIN: 'python3.12', PATH: '' } as NodeJS.ProcessEnv)).toBe('python3.12');
  });

  it('uses the default openclaw camoufox venv when present', async () => {
    const mod = await import('../../src/playwright/browser-session.js');
    const fsMod = await import('node:fs');
    vi.mocked(fsMod.existsSync).mockImplementation((path) =>
      String(path).endsWith('/.openclaw/venvs/camoufox/bin/python')
    );
    expect(mod.resolveCamoufoxPythonCommand({ HOME: '/tmp/user', PATH: '' } as NodeJS.ProcessEnv)).toBe(
      '/tmp/user/.openclaw/venvs/camoufox/bin/python'
    );
  });
});
