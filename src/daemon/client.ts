import type { JsonValue } from '../core/json.js';
import { BrowserPlatformError } from '../core/errors.js';
import { getDefaultStateStore } from './state-store.js';
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
  SessionRunScenarioApiResponse,
  SessionRunScenarioRequest,
  SessionSnapshotResponse
} from './types.js';

async function request<T>(
  info: DaemonInfo,
  route: string,
  body?: JsonValue
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${info.token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const payload = text
    ? (JSON.parse(text) as
        | T
        | { error?: { message?: string; details?: Record<string, unknown> } })
    : undefined;

  if (!response.ok) {
    const errorPayload = (
      payload as
        | { error?: { message?: string; details?: Record<string, unknown> } }
        | undefined
    )?.error;
    const message = errorPayload?.message ?? response.statusText;
    throw new BrowserPlatformError(message, {
      code: 'DAEMON_REQUEST_FAILED',
      details: errorPayload?.details
    });
  }

  return payload as T;
}

export async function readRunningDaemonInfo(): Promise<DaemonInfo> {
  const info = await getDefaultStateStore().readDaemonInfo();
  if (!info) {
    throw new BrowserPlatformError('Daemon is not initialized', {
      code: 'DAEMON_NOT_INITIALIZED'
    });
  }

  return info;
}

export async function getDaemonStatus(): Promise<DaemonStatusResponse> {
  return request<DaemonStatusResponse>(
    await readRunningDaemonInfo(),
    '/v1/daemon/status'
  );
}

export async function openSession(
  url: string,
  options?: {
    storageStatePath?: string;
    backend?: SessionBackend;
    profileId?: string;
    scenarioId?: string;
  }
): Promise<SessionOpenResponse> {
  return request<SessionOpenResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/open',
    {
      url,
      storageStatePath: options?.storageStatePath ?? null,
      backend: options?.backend ?? null,
      profileId: options?.profileId ?? null,
      scenarioId: options?.scenarioId ?? null
    }
  );
}

export async function getSessionContext(
  sessionId: string
): Promise<SessionContextResponse> {
  return request<SessionContextResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/context',
    { sessionId }
  );
}

export async function observeSession(
  sessionId: string
): Promise<SessionObserveResponse> {
  return request<SessionObserveResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/observe',
    { sessionId }
  );
}

export async function actInSession(
  sessionId: string,
  payload: SessionActionPayload
): Promise<SessionActResponse> {
  return request<SessionActResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/act',
    {
      sessionId,
      payload: payload as unknown as JsonValue
    }
  );
}

export async function snapshotSession(
  sessionId: string
): Promise<SessionSnapshotResponse> {
  return request<SessionSnapshotResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/snapshot',
    { sessionId }
  );
}

export async function runSessionScenario(
  input: SessionRunScenarioRequest
): Promise<SessionRunScenarioApiResponse> {
  return request<SessionRunScenarioApiResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/run-scenario',
    {
      pack: input.pack,
      flow: input.flow,
      query: input.query,
      profileId: input.profileId ?? null,
      maxDurationMs: input.maxDurationMs ?? null,
      backend: input.backend ?? null
    }
  );
}

export async function closeSession(
  sessionId: string
): Promise<SessionCloseResponse> {
  return request<SessionCloseResponse>(
    await readRunningDaemonInfo(),
    '/v1/session/close',
    { sessionId }
  );
}
