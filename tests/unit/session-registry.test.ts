import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../../src/daemon/session-registry.js';

describe('SessionRegistry', () => {
  it('opens, reads, and closes sessions', () => {
    const registry = new SessionRegistry();

    const opened = registry.open('https://example.com');
    expect(opened.url).toBe('https://example.com');
    expect(opened.status).toBe('open');
    expect(registry.countOpen()).toBe(1);

    const lookedUp = registry.get(opened.sessionId);
    expect(lookedUp).toEqual(opened);

    const closed = registry.close(opened.sessionId);
    expect(closed?.status).toBe('closed');
    expect(registry.countOpen()).toBe(0);
  });
});
