import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../../src/daemon/session-registry.js';

describe('SessionRegistry', () => {
  it('opens, reads, updates, and closes sessions', () => {
    const registry = new SessionRegistry();

    const opened = registry.open({
      url: 'https://example.com',
      title: 'Example Domain',
      scenarioId: 'checkout-kuper',
      profileContext: {
        profileId: 'default',
        persistent: true,
        source: 'named',
        storageStatePath: '/tmp/storage-state.json',
        storageStateExists: true
      }
    });
    expect(opened.url).toBe('https://example.com');
    expect(opened.title).toBe('Example Domain');
    expect(opened.status).toBe('open');
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

    const touched = registry.touch(opened.sessionId, { title: 'Updated Title' });
    expect(touched?.title).toBe('Updated Title');

    const closed = registry.close(opened.sessionId);
    expect(closed?.status).toBe('closed');
    expect(registry.countOpen()).toBe(0);
  });
});
