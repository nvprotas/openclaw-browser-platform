import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserPlatformError } from '../../core/errors.js';
import { getDaemonStatus, readRunningDaemonInfo } from '../../daemon/client.js';
import {
  DAEMON_BOOT_STARTED_AT_ENV,
  DAEMON_LAUNCH_ID_ENV,
  DAEMON_START_POLL_INTERVAL_MS,
  DAEMON_START_TIMEOUT_MS,
  classifyDaemonState,
  isProcessAlive,
  isStartupLockActive,
  resolveDaemonStartedAt
} from '../../daemon/lifecycle.js';
import { getDefaultStateStore } from '../../daemon/state-store.js';
import type { DaemonInfo, DaemonStatusResponse, DaemonStartupLock } from '../../daemon/types.js';
import { DAEMON_VERSION } from '../../daemon/version.js';

async function readLiveDaemonStatus(): Promise<DaemonStatusResponse | null> {
  try {
    return await getDaemonStatus();
  } catch {
    return null;
  }
}

async function resolveDaemonEntryPoint(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const distEntry = path.resolve(moduleDir, '../../daemon/entry.js');
  try {
    await access(distEntry);
    return distEntry;
  } catch {
    return path.resolve(moduleDir, '../../daemon/entry.ts');
  }
}

async function spawnDaemon(startingInfo: DaemonInfo): Promise<number> {
  const entryPoint = await resolveDaemonEntryPoint();
  const isTypeScript = entryPoint.endsWith('.ts');
  const args = isTypeScript ? ['--import', 'tsx', entryPoint] : [entryPoint];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [DAEMON_LAUNCH_ID_ENV]: startingInfo.launchId,
    [DAEMON_BOOT_STARTED_AT_ENV]: startingInfo.bootStartedAt
  };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_UNIQUE_ID;
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env
  });

  child.unref();
  if (!child.pid) {
    throw new BrowserPlatformError('Failed to determine daemon pid', { code: 'DAEMON_SPAWN_FAILED' });
  }

  return child.pid;
}

function buildOfflineStatus(info: DaemonInfo | null, state: DaemonStatusResponse['daemon']['state'], startupLock?: DaemonStartupLock | null) {
  const bootStartedAt = info?.bootStartedAt ?? startupLock?.createdAt ?? null;
  return {
    running: state === 'running',
    state,
    pid: info?.pid ?? startupLock?.pid ?? null,
    port: info?.port ?? null,
    startedAt: resolveDaemonStartedAt(info) ?? bootStartedAt,
    bootStartedAt,
    readyAt: info?.readyAt ?? null,
    uptimeMs: null,
    sessionCount: 0,
    version: info?.version ?? null
  };
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeStaleStartupLock(): Promise<void> {
  const stateStore = getDefaultStateStore();
  const startupLock = await stateStore.readStartupLock();
  if (!startupLock) {
    return;
  }

  if (isStartupLockActive(startupLock)) {
    return;
  }

  if (!isProcessAlive(startupLock.pid)) {
    await stateStore.removeStartupLock();
  }
}

async function waitForForeignLaunch(timeoutAt: number): Promise<DaemonStatusResponse | null> {
  const stateStore = getDefaultStateStore();

  while (Date.now() < timeoutAt) {
    const liveStatus = await readLiveDaemonStatus();
    if (liveStatus) {
      return liveStatus;
    }

    const [info, startupLock] = await Promise.all([stateStore.readDaemonInfo(), stateStore.readStartupLock()]);
    const state = classifyDaemonState(info, {
      reachable: false,
      startupLock
    });

    if (state === 'unhealthy') {
      throw new BrowserPlatformError('Daemon process exists but is unhealthy', {
        code: 'DAEMON_UNHEALTHY',
        details: { pid: info?.pid ?? null, state }
      });
    }

    if (state !== 'starting') {
      return null;
    }

    await waitFor(DAEMON_START_POLL_INTERVAL_MS);
  }

  throw new BrowserPlatformError('Timed out waiting for daemon to start', { code: 'DAEMON_START_TIMEOUT' });
}

async function waitForOwnLaunch(timeoutAt: number, launchId: string): Promise<DaemonStatusResponse> {
  const stateStore = getDefaultStateStore();

  while (Date.now() < timeoutAt) {
    const liveStatus = await readLiveDaemonStatus();
    if (liveStatus) {
      return liveStatus;
    }

    const [info, startupLock] = await Promise.all([stateStore.readDaemonInfo(), stateStore.readStartupLock()]);
    const state = classifyDaemonState(info, {
      reachable: false,
      startupLock
    });

    if (state === 'starting' && info?.launchId === launchId) {
      await waitFor(DAEMON_START_POLL_INTERVAL_MS);
      continue;
    }

    if (state === 'unhealthy') {
      throw new BrowserPlatformError('Daemon process exists but is unhealthy', {
        code: 'DAEMON_UNHEALTHY',
        details: { pid: info?.pid ?? null, state, launchId }
      });
    }

    throw new BrowserPlatformError('Daemon failed to become ready', {
      code: 'DAEMON_START_FAILED',
      details: { state, launchId }
    });
  }

  throw new BrowserPlatformError('Timed out waiting for daemon to start', { code: 'DAEMON_START_TIMEOUT' });
}

export async function handleDaemonEnsure(): Promise<unknown> {
  const stateStore = getDefaultStateStore();
  const timeoutAt = Date.now() + DAEMON_START_TIMEOUT_MS;

  while (Date.now() < timeoutAt) {
    const liveStatus = await readLiveDaemonStatus();
    if (liveStatus) {
      return { ok: true, daemon: { ...liveStatus.daemon, alreadyRunning: true } };
    }

    await stateStore.ensure();
    await removeStaleStartupLock();

    const [info, startupLock] = await Promise.all([stateStore.readDaemonInfo(), stateStore.readStartupLock()]);
    const state = classifyDaemonState(info, {
      reachable: false,
      startupLock
    });

    if (state === 'unhealthy') {
      throw new BrowserPlatformError('Daemon process exists but is unhealthy', {
        code: 'DAEMON_UNHEALTHY',
        details: { pid: info?.pid ?? null, state }
      });
    }

    if (state === 'starting') {
      const status = await waitForForeignLaunch(timeoutAt);
      if (status) {
        return { ok: true, daemon: { ...status.daemon, alreadyRunning: false } };
      }

      continue;
    }

    const bootStartedAt = new Date().toISOString();
    const launchId = randomUUID();
    const startupRecord: DaemonStartupLock = {
      pid: process.pid,
      createdAt: bootStartedAt,
      launchId
    };
    const lockAcquired = await stateStore.createStartupLock(startupRecord);
    if (!lockAcquired) {
      const status = await waitForForeignLaunch(timeoutAt);
      if (status) {
        return { ok: true, daemon: { ...status.daemon, alreadyRunning: false } };
      }

      continue;
    }

    try {
      const startingInfo: DaemonInfo = {
        state: 'starting',
        launchId,
        pid: null,
        port: null,
        token: null,
        bootStartedAt,
        readyAt: null,
        stoppedAt: null,
        version: DAEMON_VERSION
      };
      await stateStore.writeDaemonInfo(startingInfo);
      const daemonPid = await spawnDaemon(startingInfo);
      await stateStore.writeDaemonInfo({
        ...startingInfo,
        pid: daemonPid
      });

      const status = await waitForOwnLaunch(timeoutAt, launchId);
      return { ok: true, daemon: { ...status.daemon, alreadyRunning: false } };
    } finally {
      await stateStore.removeStartupLock();
    }
  }

  throw new BrowserPlatformError('Timed out waiting for daemon to start', { code: 'DAEMON_START_TIMEOUT' });
}

export async function handleDaemonStatus(): Promise<unknown> {
  const liveStatus = await readLiveDaemonStatus();
  if (liveStatus) {
    return liveStatus;
  }

  const stateStore = getDefaultStateStore();
  const [info, startupLock] = await Promise.all([stateStore.readDaemonInfo(), stateStore.readStartupLock()]);
  const state = classifyDaemonState(info, {
    reachable: false,
    startupLock
  });

  return {
    ok: true,
    daemon: buildOfflineStatus(info, state, startupLock)
  };
}

export async function handleDaemonRun(): Promise<never> {
  const info = await readRunningDaemonInfo();
  throw new BrowserPlatformError(`Daemon already running on port ${info.port}`, { code: 'DAEMON_ALREADY_RUNNING' });
}
