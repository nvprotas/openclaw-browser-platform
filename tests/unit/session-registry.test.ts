import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  SessionRegistry
} from '../../src/daemon/session-registry.js';

describe('SessionRegistry', () => {
  it('opens, reads, updates, and closes sessions', () => {
    const registry = new SessionRegistry();

    const opened = registry.open({
      url: 'https://example.com',
      backend: 'camoufox',
      title: 'Example Domain',
      scenarioId: 'checkout-kuper',
      profileContext: {
        profileId: 'default',
        persistent: true,
        source: 'named',
        storageStatePath: '/tmp/storage-state.json',
        storageStateExists: true,
        storageStateMtimeMs: 1000,
        storageStateAgeMs: 0,
        storageStateFresh: true
      }
    });
    expect(opened.url).toBe('https://example.com');
    expect(opened.title).toBe('Example Domain');
    expect(opened.status).toBe('open');
    expect(opened.idleTimeoutMs).toBe(DEFAULT_SESSION_IDLE_TIMEOUT_MS);
    expect(opened.scenarioContext).toMatchObject({
      scenarioId: 'checkout-kuper',
      reusePolicy: 'open_fresh_session'
    });
    expect(opened.profileContext).toMatchObject({
      profileId: 'default',
      persistent: true,
      source: 'named',
      storageStateExists: true
    });
    expect(registry.countOpen()).toBe(1);

    const lookedUp = registry.get(opened.sessionId);
    expect(lookedUp).toEqual(opened);

    const touched = registry.touch(opened.sessionId, {
      title: 'Updated Title'
    });
    expect(touched?.title).toBe('Updated Title');

    const closed = registry.close(opened.sessionId, 'manual');
    expect(closed?.status).toBe('closed');
    expect(closed?.closeReason).toBe('manual');
    expect(registry.countOpen()).toBe(0);
  });

  it('refreshes last-used time and does not expire a session after touchUsage', () => {
    let now = Date.parse('2026-04-14T10:00:00.000Z');
    const registry = new SessionRegistry({
      defaultIdleTimeoutMs: 1_000,
      now: () => now
    });

    const session = registry.open({
      url: 'https://example.com',
      backend: 'camoufox'
    });

    now += 900;
    expect(registry.findExpiredSessionIds()).toEqual([]);

    const beforeTouch = registry.get(session.sessionId)?.lastUsedAt;
    now += 50;
    const touched = registry.touchUsage(session.sessionId, {
      title: 'Still Active'
    });

    expect(touched?.title).toBe('Still Active');
    expect(touched?.lastUsedAt).not.toBe(beforeTouch);

    now += 900;
    expect(registry.findExpiredSessionIds()).toEqual([]);
  });

  it('marks sessions as expired after idle timeout and removes them from memory', () => {
    let now = Date.parse('2026-04-14T10:00:00.000Z');
    const registry = new SessionRegistry({
      defaultIdleTimeoutMs: 500,
      now: () => now
    });

    const session = registry.open({
      url: 'https://example.com',
      backend: 'camoufox'
    });

    now += 500;
    expect(registry.findExpiredSessionIds()).toEqual([session.sessionId]);

    const closed = registry.close(session.sessionId, 'idle_timeout');
    expect(closed?.closeReason).toBe('idle_timeout');
    expect(closed?.closedAt).toBe(new Date(now).toISOString());

    const removed = registry.remove(session.sessionId);
    expect(removed?.sessionId).toBe(session.sessionId);
    expect(registry.get(session.sessionId)).toBeUndefined();
  });
});
