import http from 'node:http';
import type { SessionHandoffConnect } from '../daemon/types.js';

const DEFAULT_HOST = '127.0.0.1';
const GATEWAY_ROUTE_PREFIX = '/v1/handoff/novnc';

export interface LocalNovncGatewayStatus {
  running: boolean;
  connect: SessionHandoffConnect;
}

export interface LocalNovncGatewayAdapter {
  listen(): Promise<number>;
  close(): Promise<void>;
}

export interface LocalNovncGatewayManagerOptions {
  createAdapter?: (sessionId: string, upstreamConnect: SessionHandoffConnect) => LocalNovncGatewayAdapter;
}

interface GatewayHandle {
  adapter: LocalNovncGatewayAdapter;
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

export function buildNovncUrl(sessionId: string, port: number): string {
  return `http://${DEFAULT_HOST}:${port}${GATEWAY_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`;
}

function createNovncConnect(sessionId: string, port: number): SessionHandoffConnect {
  return {
    host: DEFAULT_HOST,
    port,
    url: null,
    novncUrl: buildNovncUrl(sessionId, port)
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGatewayPage(sessionId: string, connect: SessionHandoffConnect, novncUrl: string): string {
  const encodedSessionId = escapeHtml(sessionId);
  const encodedHost = escapeHtml(connect.host);
  const encodedPort = connect.port === null ? 'n/a' : String(connect.port);
  const encodedUrl = escapeHtml(novncUrl);
  const statusPath = escapeHtml(`${GATEWAY_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}/status`);

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="cache-control" content="no-store" />
  <title>noVNC access v1</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(56, 189, 248, 0.16), transparent 42%),
        linear-gradient(180deg, #0f172a 0%, #111827 100%);
    }

    main {
      width: min(860px, calc(100vw - 32px));
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 20px;
      background: rgba(15, 23, 42, 0.82);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
      padding: 28px;
      box-sizing: border-box;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 28px;
      line-height: 1.1;
    }

    p, pre {
      margin: 0 0 12px;
      line-height: 1.5;
      color: #cbd5e1;
    }

    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 20px;
    }

    .card {
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      padding: 16px;
      background: rgba(15, 23, 42, 0.72);
    }

    .label {
      display: block;
      margin-bottom: 8px;
      color: #94a3b8;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .value {
      overflow-wrap: anywhere;
      color: #f8fafc;
    }

    .status {
      margin-top: 20px;
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.18);
    }
  </style>
</head>
<body>
  <main>
    <h1>noVNC access v1</h1>
    <p>Локальный web-access gateway для session <code>${encodedSessionId}</code>.</p>

    <div class="grid">
      <div class="card">
        <span class="label">Session</span>
        <div class="value">${encodedSessionId}</div>
      </div>
      <div class="card">
        <span class="label">VNC backend</span>
        <div class="value">${encodedHost}:${encodedPort}</div>
      </div>
      <div class="card">
        <span class="label">Gateway URL</span>
        <div class="value"><a href="${encodedUrl}">${encodedUrl}</a></div>
      </div>
    </div>

    <div class="status">
      <strong>Status:</strong> <span id="status-text">checking</span>
    </div>

    <pre id="status-json"></pre>
  </main>

  <script>
    const statusUrl = ${JSON.stringify(statusPath)};
    const statusText = document.getElementById('status-text');
    const statusJson = document.getElementById('status-json');

    async function refreshStatus() {
      try {
        const response = await fetch(statusUrl, { cache: 'no-store' });
        const payload = await response.json();
        statusText.textContent = response.ok && payload.ok ? 'ready' : 'unavailable';
        statusJson.textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        statusText.textContent = 'unavailable';
        statusJson.textContent = String(error);
      }
    }

    refreshStatus();
    setInterval(refreshStatus, 5000);
  </script>
</body>
</html>`;
}

function createDefaultAdapter(sessionId: string, upstreamConnect: SessionHandoffConnect): LocalNovncGatewayAdapter {
  let server: http.Server | null = null;

  return {
    async listen(): Promise<number> {
      server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url ?? '/', `http://${DEFAULT_HOST}`);
        const expectedRoute = `${GATEWAY_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`;
        const address = server?.address();
        const gatewayPort = address && typeof address !== 'string' ? address.port : null;
        const novncUrl = gatewayPort === null ? null : buildNovncUrl(sessionId, gatewayPort);

        if (request.method === 'GET' || request.method === 'HEAD') {
          if (requestUrl.pathname === expectedRoute || requestUrl.pathname === `${expectedRoute}/`) {
            response.statusCode = 200;
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(renderGatewayPage(sessionId, upstreamConnect, novncUrl ?? ''));
            return;
          }

          if (requestUrl.pathname === `${expectedRoute}/status`) {
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(
              `${JSON.stringify({
                ok: true,
                sessionId,
                connect: novncUrl === null ? upstreamConnect : { ...upstreamConnect, novncUrl },
                novncUrl
              })}\n`
            );
            return;
          }
        }

        response.statusCode = 404;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(`${JSON.stringify({ ok: false, error: { message: 'Not found' } })}\n`);
      });

      return await new Promise<number>((resolve, reject) => {
        if (!server) {
          reject(new Error('Failed to start local noVNC gateway'));
          return;
        }

        server.once('error', reject);
        server.listen(0, DEFAULT_HOST, () => {
          const address = server?.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Failed to start local noVNC gateway'));
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

export class LocalNovncGatewayManager {
  private readonly gateways = new Map<string, GatewayHandle>();

  constructor(private readonly options: LocalNovncGatewayManagerOptions = {}) {}

  async start(sessionId: string, upstreamConnect: SessionHandoffConnect): Promise<SessionHandoffConnect> {
    const existing = this.gateways.get(sessionId);
    if (existing) {
      return existing.connect ?? existing.ready;
    }

    const adapter = this.options.createAdapter?.(sessionId, upstreamConnect) ?? createDefaultAdapter(sessionId, upstreamConnect);
    const ready = adapter.listen().then((port) => {
      const connect = createNovncConnect(sessionId, port);
      const handle = this.gateways.get(sessionId);
      if (handle) {
        handle.connect = connect;
        handle.running = true;
      }

      return connect;
    });

    const handle: GatewayHandle = {
      adapter,
      connect: null,
      running: false,
      ready
    };

    this.gateways.set(sessionId, handle);

    try {
      return await ready;
    } catch (error) {
      this.gateways.delete(sessionId);
      throw error;
    }
  }

  status(sessionId: string): LocalNovncGatewayStatus {
    const handle = this.gateways.get(sessionId);
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
    const handle = this.gateways.get(sessionId);
    if (!handle) {
      return;
    }

    this.gateways.delete(sessionId);
    await handle.ready.catch(() => undefined);
    await handle.adapter.close();
  }

  async stopAll(): Promise<void> {
    const sessionIds = Array.from(this.gateways.keys());
    for (const sessionId of sessionIds) {
      await this.stop(sessionId);
    }
  }
}

export function createLocalNovncGatewayManager(options?: LocalNovncGatewayManagerOptions): LocalNovncGatewayManager {
  return new LocalNovncGatewayManager(options);
}
