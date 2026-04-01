import { describe, expect, it } from 'vitest';
import { LocalNovncGatewayManager } from '../../src/handoff/novnc.js';

describe('LocalNovncGatewayManager', () => {
  it('starts, reports, and stops a local gateway lifecycle', async () => {
    let closed = false;
    const manager = new LocalNovncGatewayManager({
      createAdapter: () => ({
        listen: async () => 59_101,
        close: async () => {
          closed = true;
        }
      })
    });

    const sessionId = 'session-novnc-lifecycle';
    const upstreamConnect = {
      host: '127.0.0.1',
      port: 59_001,
      url: null,
      novncUrl: null
    };

    try {
      const connect = await manager.start(sessionId, upstreamConnect);
      expect(connect).toEqual({
        host: '127.0.0.1',
        port: 59_101,
        url: null,
        novncUrl: 'http://127.0.0.1:59101/v1/handoff/novnc/session-novnc-lifecycle'
      });

      expect(manager.status(sessionId)).toEqual({
        running: true,
        connect
      });

      await manager.stop(sessionId);

      expect(closed).toBe(true);
      expect(manager.status(sessionId)).toEqual({
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

  it('stops all running gateways', async () => {
    const closedSessions: string[] = [];
    let nextPort = 59_201;
    const manager = new LocalNovncGatewayManager({
      createAdapter: (sessionId) => ({
        listen: async () => nextPort++,
        close: async () => {
          closedSessions.push(sessionId);
        }
      })
    });

    const upstreamConnect = {
      host: '127.0.0.1',
      port: 59_001,
      url: null,
      novncUrl: null
    };

    await manager.start('session-one', upstreamConnect);
    await manager.start('session-two', upstreamConnect);

    await manager.stopAll();

    expect(closedSessions).toEqual(expect.arrayContaining(['session-one', 'session-two']));
    expect(manager.status('session-one')).toEqual({
      running: false,
      connect: {
        host: '127.0.0.1',
        port: null,
        url: null,
        novncUrl: null
      }
    });
    expect(manager.status('session-two')).toEqual({
      running: false,
      connect: {
        host: '127.0.0.1',
        port: null,
        url: null,
        novncUrl: null
      }
    });
  });
});
