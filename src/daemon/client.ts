import type { JsonValue } from '../core/json.js';
import { BrowserPlatformError } from '../core/errors.js';
import { getDefaultStateStore } from './state-store.js';
import { DAEMON_STATUS_REQUEST_TIMEOUT_MS } from './lifecycle.js';
import type {
  DaemonInfo,
  DaemonStatusResponse,
  SessionActResponse,
  SessionActionPayload,
  SessionBackend,
  SessionCloseResponse,
  SessionContextResponse,
  SessionObserveResponse,
  SessionOpenResponse,
  SessionSnapshotResponse
} from './types.js';

function resolveConnectionInfo(info: DaemonInfo): { port: number; token: string } {
  if (info.state !== 'running' || info.port === null || info.token === null) {
    throw new BrowserPlatformError('Daemon is not ready', {
      code: 'DAEMON_NOT_READY',
      details: { state: info.state }
    });
  }

  return {
    port: info.port,
    token: info.token
  };
}

async function request<T>(info: DaemonInfo, route: string, body?: JsonValue, options?: { timeoutMs?: number }): Promise<T> {
  const connection = resolveConnectionInfo(info);
  let response: Response;

  try {
    response = await fetch(`http://127.0.0.1:${connection.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${connection.token}`
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(options?.timeoutMs ?? 30_000)
    });
  } catch (error) {
    if (error instanceof BrowserPlatformError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new BrowserPlatformError('Daemon request timed out', { code: 'DAEMON_REQUEST_TIMEOUT' });
    }

    throw new BrowserPlatformError(error instanceof Error ? error.message : 'Failed to reach daemon', {
      code: 'DAEMON_UNREACHABLE'
    });
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T | { error?: { message?: string; details?: Record<string, unknown> } }) : undefined;

  if (!response.ok) {
    const errorPayload = (payload as { error?: { message?: string; details?: Record<string, unknown> } } | undefined)?.error;
    const message = errorPayload?.message ?? response.statusText;
    throw new BrowserPlatformError(message, { code: 'DAEMON_REQUEST_FAILED', details: errorPayload?.details });
  }

  return payload as T;
}

export async function readRunningDaemonInfo(): Promise<DaemonInfo> {
  const info = await getDefaultStateStore().readDaemonInfo();
  if (!info) {
    throw new BrowserPlatformError('Daemon is not initialized', { code: 'DAEMON_NOT_INITIALIZED' });
  }

  resolveConnectionInfo(info);
  return info;
}

export async function getDaemonStatus(options?: { timeoutMs?: number }): Promise<DaemonStatusResponse> {
  return request<DaemonStatusResponse>(await readRunningDaemonInfo(), '/v1/daemon/status', undefined, {
    timeoutMs: options?.timeoutMs ?? DAEMON_STATUS_REQUEST_TIMEOUT_MS
  });
}

export async function openSession(
  url: string,
  options?: { storageStatePath?: string; backend?: SessionBackend; profileId?: string; scenarioId?: string }
): Promise<SessionOpenResponse> {
  return request<SessionOpenResponse>(await readRunningDaemonInfo(), '/v1/session/open', {
    url,
    storageStatePath: options?.storageStatePath ?? null,
    backend: options?.backend ?? null,
    profileId: options?.profileId ?? null,
    scenarioId: options?.scenarioId ?? null
  });
}

export async function getSessionContext(sessionId: string): Promise<SessionContextResponse> {
  return request<SessionContextResponse>(await readRunningDaemonInfo(), '/v1/session/context', { sessionId });
}

export async function observeSession(sessionId: string): Promise<SessionObserveResponse> {
  return request<SessionObserveResponse>(await readRunningDaemonInfo(), '/v1/session/observe', { sessionId });
}

export async function actInSession(sessionId: string, payload: SessionActionPayload): Promise<SessionActResponse> {
  return request<SessionActResponse>(await readRunningDaemonInfo(), '/v1/session/act', {
    sessionId,
    payload: payload as unknown as JsonValue
  });
}

export async function snapshotSession(sessionId: string): Promise<SessionSnapshotResponse> {
  return request<SessionSnapshotResponse>(await readRunningDaemonInfo(), '/v1/session/snapshot', { sessionId });
}

export async function closeSession(sessionId: string): Promise<SessionCloseResponse> {
  return request<SessionCloseResponse>(await readRunningDaemonInfo(), '/v1/session/close', { sessionId });
}
