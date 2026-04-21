import type { DaemonInfo, DaemonLifecycleState, DaemonStartupLock } from './types.js';

export const DAEMON_START_TIMEOUT_MS = 5_000;
export const DAEMON_START_POLL_INTERVAL_MS = 100;
export const DAEMON_STARTUP_GRACE_MS = 5_000;
export const DAEMON_STATUS_REQUEST_TIMEOUT_MS = 750;
export const DAEMON_LAUNCH_ID_ENV = 'BROWSER_PLATFORM_DAEMON_LAUNCH_ID';
export const DAEMON_BOOT_STARTED_AT_ENV = 'BROWSER_PLATFORM_DAEMON_BOOT_STARTED_AT';

export function isProcessAlive(pid: number | null): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function isStartupLockActive(
  lock: DaemonStartupLock | null,
  options: { nowMs?: number; startupGraceMs?: number } = {}
): boolean {
  if (!lock || !isProcessAlive(lock.pid)) {
    return false;
  }

  const createdAtMs = Date.parse(lock.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return true;
  }

  const nowMs = options.nowMs ?? Date.now();
  const startupGraceMs = options.startupGraceMs ?? DAEMON_STARTUP_GRACE_MS;
  return nowMs - createdAtMs <= startupGraceMs;
}

export function resolveDaemonStartedAt(info: DaemonInfo | null): string | null {
  if (!info) {
    return null;
  }

  return info.readyAt ?? info.bootStartedAt;
}

export function classifyDaemonState(
  info: DaemonInfo | null,
  options: {
    reachable: boolean;
    startupLock?: DaemonStartupLock | null;
    nowMs?: number;
    startupGraceMs?: number;
  }
): DaemonLifecycleState {
  if (options.reachable) {
    return 'running';
  }

  if (!info) {
    return isStartupLockActive(options.startupLock ?? null, options) ? 'starting' : 'stopped';
  }

  if (info.state === 'stopped') {
    return 'stopped';
  }

  if (!isProcessAlive(info.pid)) {
    return 'stale';
  }

  if (info.state === 'starting') {
    const bootStartedAtMs = Date.parse(info.bootStartedAt);
    if (!Number.isFinite(bootStartedAtMs)) {
      return 'starting';
    }

    const nowMs = options.nowMs ?? Date.now();
    const startupGraceMs = options.startupGraceMs ?? DAEMON_STARTUP_GRACE_MS;
    return nowMs - bootStartedAtMs <= startupGraceMs ? 'starting' : 'unhealthy';
  }

  return 'unhealthy';
}
