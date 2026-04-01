import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../../src/daemon/session-registry.js';

describe('SessionRegistry', () => {
  it('opens, reads, updates, and closes sessions', () => {
    const registry = new SessionRegistry();

    const opened = registry.open({ url: 'https://example.com', title: 'Example Domain' });
    expect(opened.url).toBe('https://example.com');
    expect(opened.title).toBe('Example Domain');
    expect(opened.status).toBe('open');
    expect(opened.handoff).toMatchObject({
      active: false,
      mode: 'vnc',
      connect: {
        host: '127.0.0.1',
        port: null,
        url: null,
        novncUrl: null
      }
    });
    expect(registry.countOpen()).toBe(1);

    const lookedUp = registry.get(opened.sessionId);
    expect(lookedUp).toEqual(opened);

    const touched = registry.touch(opened.sessionId, { title: 'Updated Title' });
    expect(touched?.title).toBe('Updated Title');

    const started = registry.startHandoff(opened.sessionId, 'auth_boundary');
    expect(started?.handoff).toMatchObject({
      active: true,
      mode: 'vnc',
      reason: 'auth_boundary',
      startedAt: expect.any(String)
    });

    const resumed = registry.resumeHandoff(opened.sessionId);
    expect(resumed?.handoff).toMatchObject({
      active: false,
      reason: 'auth_boundary',
      resumedAt: expect.any(String),
      connect: {
        host: '127.0.0.1',
        port: null,
        url: null,
        novncUrl: null
      }
    });

    const stopped = registry.stopHandoff(opened.sessionId);
    expect(stopped?.handoff).toMatchObject({
      active: false,
      mode: 'vnc',
      connect: {
        host: '127.0.0.1',
        port: null,
        url: null,
        novncUrl: null
      },
      stoppedAt: expect.any(String)
    });

    const closed = registry.close(opened.sessionId);
    expect(closed?.status).toBe('closed');
    expect(registry.countOpen()).toBe(0);
  });
});
