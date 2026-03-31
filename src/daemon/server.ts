import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { getDefaultStateStore } from './state-store.js';
import { SessionRegistry } from './session-registry.js';
import type { DaemonInfo, DaemonStatusResponse } from './types.js';

const VERSION = '0.1.0';

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function startDaemonServer(): Promise<DaemonInfo> {
  const registry = new SessionRegistry();
  const stateStore = getDefaultStateStore();
  const token = randomBytes(24).toString('hex');
  const startedAt = new Date().toISOString();

  const server = http.createServer(async (request, response) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${token}`) {
      sendJson(response, 401, { ok: false, error: { message: 'Unauthorized' } });
      return;
    }

    try {
      if (request.method === 'GET' && request.url === '/v1/daemon/status') {
        const payload: DaemonStatusResponse = {
          ok: true,
          daemon: {
            pid: process.pid,
            port: (server.address() as { port: number }).port,
            startedAt,
            uptimeMs: Math.round(process.uptime() * 1000),
            sessionCount: registry.countOpen(),
            version: VERSION
          }
        };
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/open') {
        const body = (await readJsonBody(request)) as { url?: string };
        if (!body?.url) {
          sendJson(response, 400, { ok: false, error: { message: 'Missing url' } });
          return;
        }

        sendJson(response, 200, { ok: true, session: registry.open(body.url) });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/context') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.get(body.sessionId) : undefined;
        if (!session) {
          sendJson(response, 404, { ok: false, error: { message: 'Session not found' } });
          return;
        }

        sendJson(response, 200, { ok: true, session });
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/session/close') {
        const body = (await readJsonBody(request)) as { sessionId?: string };
        const session = body?.sessionId ? registry.close(body.sessionId) : undefined;
        if (!session) {
          sendJson(response, 404, { ok: false, error: { message: 'Session not found' } });
          return;
        }

        sendJson(response, 200, { ok: true, session });
        return;
      }

      sendJson(response, 404, { ok: false, error: { message: 'Not found' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      sendJson(response, 500, { ok: false, error: { message } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const info: DaemonInfo = {
    pid: process.pid,
    port: (server.address() as { port: number }).port,
    token,
    startedAt,
    version: VERSION
  };

  await stateStore.writeDaemonInfo(info);

  const shutdown = async (): Promise<void> => {
    server.close();
  };

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });

  return info;
}
