import type { JsonValue } from '../core/json.js';
import { BrowserPlatformError } from '../core/errors.js';
import { getDefaultStateStore } from './state-store.js';
import type {
  DaemonInfo,
  DaemonStatusResponse,
  SessionActResponse,
  SessionActionPayload,
  SessionCloseResponse,
  SessionHandoffResponse,
  SessionContextResponse,
  SessionObserveResponse,
  SessionOpenResponse,
  SessionSnapshotResponse
} from './types.js';

async function request<T>(info: DaemonInfo, route: string, body?: JsonValue): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${info.token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T | { error?: { message?: string; code?: string; details?: Record<string, unknown> } }) : undefined;

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: Record<string, unknown> } } | undefined)?.error;
    const message = error?.message ?? response.statusText;
    throw new BrowserPlatformError(message, {
      code: error?.code ?? 'DAEMON_REQUEST_FAILED',
      details: error?.details
    });
  }

  return payload as T;
}

export async function readRunningDaemonInfo(): Promise<DaemonInfo> {
  const info = await getDefaultStateStore().readDaemonInfo();
  if (!info) {
    throw new BrowserPlatformError('Daemon is not initialized', { code: 'DAEMON_NOT_INITIALIZED' });
  }

  return info;
}

export async function getDaemonStatus(): Promise<DaemonStatusResponse> {
  return request<DaemonStatusResponse>(await readRunningDaemonInfo(), '/v1/daemon/status');
}

export async function openSession(url: string, options?: { storageStatePath?: string }): Promise<SessionOpenResponse> {
  return request<SessionOpenResponse>(await readRunningDaemonInfo(), '/v1/session/open', {
    url,
    storageStatePath: options?.storageStatePath ?? null
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

export async function startHandoff(sessionId: string, options?: { reason?: string | null }): Promise<SessionHandoffResponse> {
  return request<SessionHandoffResponse>(await readRunningDaemonInfo(), '/v1/handoff/start', {
    sessionId,
    reason: options?.reason ?? null
  });
}

export async function getHandoffStatus(sessionId: string): Promise<SessionHandoffResponse> {
  return request<SessionHandoffResponse>(await readRunningDaemonInfo(), '/v1/handoff/status', { sessionId });
}

export async function resumeHandoff(sessionId: string): Promise<SessionHandoffResponse> {
  return request<SessionHandoffResponse>(await readRunningDaemonInfo(), '/v1/handoff/resume', { sessionId });
}

export async function stopHandoff(sessionId: string): Promise<SessionHandoffResponse> {
  return request<SessionHandoffResponse>(await readRunningDaemonInfo(), '/v1/handoff/stop', { sessionId });
}
