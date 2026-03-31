import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { BrowserPlatformError } from '../../core/errors.js';
import { getDaemonStatus, readRunningDaemonInfo } from '../../daemon/client.js';
import { getDefaultStateStore } from '../../daemon/state-store.js';

async function isDaemonReachable(): Promise<boolean> {
  try {
    await getDaemonStatus();
    return true;
  } catch {
    return false;
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

async function spawnDaemon(): Promise<void> {
  const entryPoint = await resolveDaemonEntryPoint();
  const isTypeScript = entryPoint.endsWith('.ts');
  const args = isTypeScript ? ['--import', 'tsx', entryPoint] : [entryPoint];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
}

export async function handleDaemonEnsure(): Promise<unknown> {
  if (await isDaemonReachable()) {
    const status = await getDaemonStatus();
    return { ok: true, daemon: { ...status.daemon, alreadyRunning: true } };
  }

  await getDefaultStateStore().ensure();
  await spawnDaemon();

  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    if (await isDaemonReachable()) {
      const status = await getDaemonStatus();
      return { ok: true, daemon: { ...status.daemon, alreadyRunning: false } };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new BrowserPlatformError('Timed out waiting for daemon to start', { code: 'DAEMON_START_TIMEOUT' });
}

export async function handleDaemonStatus(): Promise<unknown> {
  const info = await getDefaultStateStore().readDaemonInfo();
  if (!info) {
    return {
      ok: true,
      daemon: {
        running: false,
        pid: null,
        port: null,
        startedAt: null,
        uptimeMs: null,
        sessionCount: 0,
        version: null
      }
    };
  }

  if (!(await isDaemonReachable())) {
    return {
      ok: true,
      daemon: {
        running: false,
        pid: info.pid,
        port: info.port,
        startedAt: info.startedAt,
        uptimeMs: null,
        sessionCount: 0,
        version: info.version
      }
    };
  }

  const status = await getDaemonStatus();
  return {
    ok: true,
    daemon: {
      running: true,
      ...status.daemon
    }
  };
}

export async function handleDaemonRun(): Promise<never> {
  const info = await readRunningDaemonInfo();
  throw new BrowserPlatformError(`Daemon already running on port ${info.port}`, { code: 'DAEMON_ALREADY_RUNNING' });
}
