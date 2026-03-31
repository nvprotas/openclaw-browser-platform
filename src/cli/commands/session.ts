import { requireFlag } from '../argv.js';
import { closeSession, getSessionContext, openSession } from '../../daemon/client.js';
import { handleDaemonEnsure } from './daemon.js';

export async function handleSessionOpen(args: string[]): Promise<unknown> {
  await handleDaemonEnsure();
  const url = requireFlag(args, '--url');
  return openSession(url);
}

export async function handleSessionContext(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return getSessionContext(sessionId);
}

export async function handleSessionClose(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return closeSession(sessionId);
}
