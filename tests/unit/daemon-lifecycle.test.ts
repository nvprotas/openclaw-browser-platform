import { describe, expect, it } from 'vitest';
import { classifyDaemonState, isStartupLockActive, resolveDaemonStartedAt } from '../../src/daemon/lifecycle.js';
import type { DaemonInfo } from '../../src/daemon/types.js';

function createInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
  return {
    state: 'running',
    launchId: 'launch-1',
    pid: process.pid,
    port: 3210,
    token: 'token',
    bootStartedAt: '2026-04-21T10:00:00.000Z',
    readyAt: '2026-04-21T10:00:01.000Z',
    stoppedAt: null,
    version: '0.1.0',
    ...overrides
  };
}

describe('daemon lifecycle helpers', () => {
  it('classifies a live startup lock without daemon info as starting', () => {
    const state = classifyDaemonState(null, {
      reachable: false,
      startupLock: {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        launchId: 'launch-lock'
      }
    });

    expect(state).toBe('starting');
  });

  it('classifies a dead daemon record as stale', () => {
    const state = classifyDaemonState(
      createInfo({
        pid: 999_999_999
      }),
      {
        reachable: false
      }
    );

    expect(state).toBe('stale');
  });

  it('classifies a live but unreachable running daemon as unhealthy', () => {
    const state = classifyDaemonState(createInfo(), {
      reachable: false
    });

    expect(state).toBe('unhealthy');
  });

  it('keeps a fresh starting daemon within grace period as starting', () => {
    const nowMs = Date.parse('2026-04-21T10:00:04.000Z');
    const state = classifyDaemonState(
      createInfo({
        state: 'starting',
        readyAt: null,
        bootStartedAt: '2026-04-21T10:00:00.000Z'
      }),
      {
        reachable: false,
        nowMs,
        startupGraceMs: 5_000
      }
    );

    expect(state).toBe('starting');
  });

  it('marks a long-starting daemon as unhealthy after the grace window', () => {
    const nowMs = Date.parse('2026-04-21T10:00:06.000Z');
    const state = classifyDaemonState(
      createInfo({
        state: 'starting',
        readyAt: null,
        bootStartedAt: '2026-04-21T10:00:00.000Z'
      }),
      {
        reachable: false,
        nowMs,
        startupGraceMs: 5_000
      }
    );

    expect(state).toBe('unhealthy');
  });

  it('treats startup locks as active only within the grace window', () => {
    const lock = {
      pid: process.pid,
      createdAt: '2026-04-21T10:00:00.000Z',
      launchId: 'launch-lock'
    };

    expect(isStartupLockActive(lock, { nowMs: Date.parse('2026-04-21T10:00:03.000Z'), startupGraceMs: 5_000 })).toBe(true);
    expect(isStartupLockActive(lock, { nowMs: Date.parse('2026-04-21T10:00:07.000Z'), startupGraceMs: 5_000 })).toBe(
      false
    );
  });

  it('prefers readyAt when reporting startedAt compatibility', () => {
    expect(resolveDaemonStartedAt(createInfo())).toBe('2026-04-21T10:00:01.000Z');
    expect(resolveDaemonStartedAt(createInfo({ readyAt: null }))).toBe('2026-04-21T10:00:00.000Z');
  });
});
