import net from 'node:net';
import type { SessionHandoffConnect } from '../daemon/types.js';

const DEFAULT_HOST = '127.0.0.1';

export interface LocalVncBackendStatus {
  running: boolean;
  connect: SessionHandoffConnect;
}

export interface LocalVncBackendAdapter {
  listen(): Promise<number>;
  close(): Promise<void>;
}

export interface LocalVncBackendManagerOptions {
  createAdapter?: () => LocalVncBackendAdapter;
}

interface BackendHandle {
  adapter: LocalVncBackendAdapter;
  connect: SessionHandoffConnect | null;
  running: boolean;
  ready: Promise<SessionHandoffConnect>;
}

function createDefaultConnect(): SessionHandoffConnect {
  return {
    host: DEFAULT_HOST,
    port: null,
    url: null,
    novncUrl: null
  };
}

function createConnect(port: number): SessionHandoffConnect {
  return {
    host: DEFAULT_HOST,
    port,
    url: null,
    novncUrl: null
  };
}

function createDefaultAdapter(): LocalVncBackendAdapter {
  let server: net.Server | null = null;

  return {
    async listen(): Promise<number> {
      server = net.createServer((socket) => {
        socket.setNoDelay(true);
        socket.end();
      });

      return await new Promise<number>((resolve, reject) => {
        if (!server) {
          reject(new Error('Failed to start local VNC backend'));
          return;
        }

        server.once('error', reject);
        server.listen(0, DEFAULT_HOST, () => {
          const address = server?.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Failed to start local VNC backend'));
            return;
          }

          resolve(address.port);
        });
      });
    },
    async close(): Promise<void> {
      if (!server) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      server = null;
    }
  };
}

export class LocalVncBackendManager {
  private readonly backends = new Map<string, BackendHandle>();

  constructor(private readonly options: LocalVncBackendManagerOptions = {}) {}

  async start(sessionId: string): Promise<SessionHandoffConnect> {
    const existing = this.backends.get(sessionId);
    if (existing) {
      return existing.connect ?? existing.ready;
    }

    const adapter = this.options.createAdapter?.() ?? createDefaultAdapter();
    const ready = adapter.listen().then((port) => {
      const connect = createConnect(port);
      const handle = this.backends.get(sessionId);
      if (handle) {
        handle.connect = connect;
        handle.running = true;
      }

      return connect;
    });

    const handle: BackendHandle = {
      adapter,
      connect: null,
      running: false,
      ready
    };

    this.backends.set(sessionId, handle);

    try {
      return await ready;
    } catch (error) {
      this.backends.delete(sessionId);
      throw error;
    }
  }

  status(sessionId: string): LocalVncBackendStatus {
    const handle = this.backends.get(sessionId);
    if (!handle || !handle.running || !handle.connect) {
      return {
        running: false,
        connect: createDefaultConnect()
      };
    }

    return {
      running: true,
      connect: handle.connect
    };
  }

  async stop(sessionId: string): Promise<void> {
    const handle = this.backends.get(sessionId);
    if (!handle) {
      return;
    }

    this.backends.delete(sessionId);
    await handle.ready.catch(() => undefined);
    await handle.adapter.close();
  }

  async stopAll(): Promise<void> {
    const sessionIds = Array.from(this.backends.keys());
    for (const sessionId of sessionIds) {
      await this.stop(sessionId);
    }
  }
}

export function createLocalVncBackendManager(options?: LocalVncBackendManagerOptions): LocalVncBackendManager {
  return new LocalVncBackendManager(options);
}
