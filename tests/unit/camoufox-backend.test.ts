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
    try {
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
      await session.close();

      expect(latestProc!.killSignals).toEqual(['SIGTERM']);

      await vi.advanceTimersByTimeAsync(3_000);

      expect(latestProc!.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    } finally {
      vi.useRealTimers();
    }
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
