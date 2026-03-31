import { BrowserPlatformError } from '../../core/errors.js';
import { requireFlag } from '../argv.js';
import { actInSession, closeSession, getSessionContext, observeSession, openSession, snapshotSession } from '../../daemon/client.js';
import { handleDaemonEnsure } from './daemon.js';
import type { SessionActionPayload } from '../../daemon/types.js';

export async function handleSessionOpen(args: string[]): Promise<unknown> {
  await handleDaemonEnsure();
  const url = requireFlag(args, '--url');
  return openSession(url);
}

export async function handleSessionContext(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return getSessionContext(sessionId);
}

export async function handleSessionObserve(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return observeSession(sessionId);
}

export async function handleSessionAct(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  const json = requireFlag(args, '--json');

  let payload: SessionActionPayload;
  try {
    payload = JSON.parse(json) as SessionActionPayload;
  } catch (error) {
    throw new BrowserPlatformError('Invalid action payload JSON', {
      code: 'INVALID_JSON_PAYLOAD',
      details: { cause: error instanceof Error ? error.message : String(error) }
    });
  }

  if (!payload || typeof payload !== 'object' || !('action' in payload)) {
    throw new BrowserPlatformError('Action payload must contain an action field', { code: 'INVALID_ACTION_PAYLOAD' });
  }

  return actInSession(sessionId, payload);
}

export async function handleSessionSnapshot(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return snapshotSession(sessionId);
}

export async function handleSessionClose(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return closeSession(sessionId);
}
