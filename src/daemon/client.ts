import type { JsonValue } from '../core/json.js';
import { BrowserPlatformError } from '../core/errors.js';
import { getDefaultStateStore } from './state-store.js';
import type {
  DaemonInfo,
  DaemonStatusResponse,
  SessionCloseResponse,
  SessionContextResponse,
  SessionOpenResponse
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
  const payload = text ? (JSON.parse(text) as T | { error?: { message?: string } }) : undefined;

  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | undefined)?.error?.message ?? response.statusText;
    throw new BrowserPlatformError(message, { code: 'DAEMON_REQUEST_FAILED' });
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

export async function openSession(url: string): Promise<SessionOpenResponse> {
  return request<SessionOpenResponse>(await readRunningDaemonInfo(), '/v1/session/open', { url });
}

export async function getSessionContext(sessionId: string): Promise<SessionContextResponse> {
  return request<SessionContextResponse>(await readRunningDaemonInfo(), '/v1/session/context', { sessionId });
}

export async function closeSession(sessionId: string): Promise<SessionCloseResponse> {
  return request<SessionCloseResponse>(await readRunningDaemonInfo(), '/v1/session/close', { sessionId });
}
