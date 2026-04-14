import { describe, expect, it, vi } from 'vitest';
import { resolveSessionIdleTimeoutMs, runSessionJanitorPass } from '../../src/daemon/server.js';
import { DEFAULT_SESSION_IDLE_TIMEOUT_MS, SessionRegistry } from '../../src/daemon/session-registry.js';

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
});
