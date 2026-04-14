import { describe, expect, it, vi } from 'vitest';
import { createSessionJanitorRunner, resolveSessionIdleTimeoutMs, runSessionJanitorPass } from '../../src/daemon/server.js';
import { DEFAULT_SESSION_IDLE_TIMEOUT_MS, SessionRegistry } from '../../src/daemon/session-registry.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('daemon session idle handling', () => {
  it('uses 30 minutes as the default idle timeout', () => {
    expect(resolveSessionIdleTimeoutMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS);
  });

  it('supports overriding the idle timeout from environment', () => {
    expect(resolveSessionIdleTimeoutMs({ BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS: '12345' } as NodeJS.ProcessEnv)).toBe(12_345);
    expect(resolveSessionIdleTimeoutMs({ BROWSER_PLATFORM_SESSION_IDLE_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_SESSION_IDLE_TIMEOUT_MS
    );
  });

  it('closes expired sessions through the real janitor path and repeated passes are safe', async () => {
    let now = Date.parse('2026-04-14T10:00:00.000Z');
    const registry = new SessionRegistry({
      defaultIdleTimeoutMs: 1_000,
      now: () => now
    });
    const session = registry.open({ url: 'https://example.com' });
    const controller = {
      closeSession: vi.fn(async () => undefined)
    };

    now += 1_000;
    await runSessionJanitorPass(registry, controller as never);

    expect(controller.closeSession).toHaveBeenCalledTimes(1);
    expect(controller.closeSession).toHaveBeenCalledWith(session.sessionId);
    expect(registry.get(session.sessionId)).toBeUndefined();
    expect(registry.countOpen()).toBe(0);

    await runSessionJanitorPass(registry, controller as never);
    expect(controller.closeSession).toHaveBeenCalledTimes(1);
  });

  it('waits for closeSession to finish before removing an expired session from registry', async () => {
    let now = Date.parse('2026-04-14T10:00:00.000Z');
    const registry = new SessionRegistry({
      defaultIdleTimeoutMs: 1_000,
      now: () => now
    });
    const session = registry.open({ url: 'https://example.com' });
    const closeBarrier = createDeferred<void>();
    const controller = {
      closeSession: vi.fn(async () => {
        await closeBarrier.promise;
      })
    };

    now += 1_000;
    let finished = false;
    const janitorPass = runSessionJanitorPass(registry, controller as never).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(controller.closeSession).toHaveBeenCalledWith(session.sessionId);
    expect(registry.get(session.sessionId)?.status).toBe('open');
    expect(finished).toBe(false);

    closeBarrier.resolve();
    await janitorPass;

    expect(registry.get(session.sessionId)).toBeUndefined();
    expect(finished).toBe(true);
  });

  it('does not start overlapping janitor close calls for the same expired session when one pass is already running', async () => {
    let now = Date.parse('2026-04-14T10:00:00.000Z');
    const registry = new SessionRegistry({
      defaultIdleTimeoutMs: 1_000,
      now: () => now
    });
    const session = registry.open({ url: 'https://example.com' });
    const closeBarrier = createDeferred<void>();
    const controller = {
      closeSession: vi.fn(async () => {
        await closeBarrier.promise;
      })
    };
    const runSafely = createSessionJanitorRunner(registry, controller as never);

    now += 1_000;
    const firstPass = runSafely();
    const secondPass = runSafely();

    await Promise.resolve();
    expect(controller.closeSession).toHaveBeenCalledTimes(1);

    closeBarrier.resolve();
    await Promise.all([firstPass, secondPass]);

    expect(registry.get(session.sessionId)).toBeUndefined();
  });
});
