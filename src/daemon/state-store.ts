import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PERSISTED_DAEMON_STATES, type DaemonInfo, type DaemonStartupLock, type PersistedDaemonState } from './types.js';

function resolvePackageRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));

  if (moduleDir.includes(`${path.sep}dist${path.sep}`)) {
    return path.resolve(moduleDir, '..', '..', '..');
  }

  return path.resolve(moduleDir, '..', '..');
}

const DEFAULT_ROOT = path.resolve(resolvePackageRoot(), '.tmp/browser-platform');
const DAEMON_INFO_FILENAME = 'daemon.json';
const STARTUP_LOCK_FILENAME = 'daemon-start.lock';
const ENV_STATE_ROOT = 'BROWSER_PLATFORM_STATE_ROOT';

function resolveDefaultRoot(): string {
  const override = process.env[ENV_STATE_ROOT]?.trim();
  return override ? path.resolve(override) : DEFAULT_ROOT;
}

export class StateStore {
  constructor(private readonly rootDir = resolveDefaultRoot()) {}

  get root(): string {
    return this.rootDir;
  }

  get daemonInfoPath(): string {
    return path.join(this.rootDir, DAEMON_INFO_FILENAME);
  }

  get startupLockPath(): string {
    return path.join(this.rootDir, STARTUP_LOCK_FILENAME);
  }

  async ensure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async readDaemonInfo(): Promise<DaemonInfo | null> {
    try {
      const raw = await readFile(this.daemonInfoPath, 'utf8');
      return normalizeDaemonInfo(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async writeDaemonInfo(info: DaemonInfo): Promise<void> {
    await this.ensure();
    await writeFile(this.daemonInfoPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
  }

  async readStartupLock(): Promise<DaemonStartupLock | null> {
    try {
      const raw = await readFile(this.startupLockPath, 'utf8');
      return normalizeStartupLock(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async createStartupLock(lock: DaemonStartupLock): Promise<boolean> {
    await this.ensure();

    try {
      await writeFile(this.startupLockPath, `${JSON.stringify(lock, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx'
      });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }

      throw error;
    }
  }

  async removeStartupLock(): Promise<void> {
    await rm(this.startupLockPath, { force: true });
  }
}

export function getDefaultStateStore(): StateStore {
  return new StateStore();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeDaemonInfo(value: unknown): DaemonInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.state === 'string' && PERSISTED_DAEMON_STATES.includes(value.state as (typeof PERSISTED_DAEMON_STATES)[number])) {
    const state = value.state as PersistedDaemonState;
    if (
      typeof value.launchId !== 'string' ||
      typeof value.bootStartedAt !== 'string' ||
      (value.readyAt !== null && typeof value.readyAt !== 'string') ||
      (value.stoppedAt !== null && typeof value.stoppedAt !== 'string') ||
      typeof value.version !== 'string'
    ) {
      return null;
    }

    return {
      state,
      launchId: value.launchId,
      pid: typeof value.pid === 'number' ? value.pid : null,
      port: typeof value.port === 'number' ? value.port : null,
      token: typeof value.token === 'string' ? value.token : null,
      bootStartedAt: value.bootStartedAt,
      readyAt: value.readyAt ?? null,
      stoppedAt: value.stoppedAt ?? null,
      version: value.version
    };
  }

  if (
    typeof value.pid === 'number' &&
    typeof value.port === 'number' &&
    typeof value.token === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.version === 'string'
  ) {
    return {
      state: 'running',
      launchId: 'legacy-daemon-record',
      pid: value.pid,
      port: value.port,
      token: value.token,
      bootStartedAt: value.startedAt,
      readyAt: value.startedAt,
      stoppedAt: null,
      version: value.version
    };
  }

  return null;
}

function normalizeStartupLock(value: unknown): DaemonStartupLock | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.pid !== 'number' || typeof value.createdAt !== 'string' || typeof value.launchId !== 'string') {
    return null;
  }

  return {
    pid: value.pid,
    createdAt: value.createdAt,
    launchId: value.launchId
  };
}
