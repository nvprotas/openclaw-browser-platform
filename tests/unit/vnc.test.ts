import { describe, expect, it } from 'vitest';
import { LocalVncBackendManager } from '../../src/handoff/vnc.js';

describe('LocalVncBackendManager', () => {
  it('starts, reports, and stops a local backend lifecycle', async () => {
    let closed = false;
    const manager = new LocalVncBackendManager({
      createAdapter: () => ({
        listen: async () => 59_001,
        close: async () => {
          closed = true;
        }
      })
    });

    const sessionId = 'session-vnc-lifecycle';

    try {
      const connect = await manager.start(sessionId);
      expect(connect).toMatchObject({
        host: '127.0.0.1',
        port: 59_001,
        url: null,
        novncUrl: null
      });

      expect(manager.status(sessionId)).toMatchObject({
        running: true,
        connect
      });

      await manager.stop(sessionId);

      expect(closed).toBe(true);
      expect(manager.status(sessionId)).toMatchObject({
        running: false,
        connect: {
          host: '127.0.0.1',
          port: null,
          url: null,
          novncUrl: null
        }
      });
    } finally {
      await manager.stop(sessionId);
    }
  });
});
