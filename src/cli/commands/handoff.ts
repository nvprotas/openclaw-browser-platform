import { BrowserPlatformError } from '../../core/errors.js';
import { requireFlag } from '../argv.js';
import { getHandoffStatus, resumeHandoff, startHandoff, stopHandoff } from '../../daemon/client.js';

function readOptionalFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    return undefined;
  }

  return value;
}

export async function handleHandoffStart(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  const reason = validateHandoffReason(readOptionalFlagValue(args, '--reason'));

  return startHandoff(sessionId, {
    reason: reason ?? null
  });
}

export async function handleHandoffStatus(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return getHandoffStatus(sessionId);
}

export async function handleHandoffResume(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return resumeHandoff(sessionId);
}

export async function handleHandoffStop(args: string[]): Promise<unknown> {
  const sessionId = requireFlag(args, '--session');
  return stopHandoff(sessionId);
}

export function validateHandoffReason(reason: string | null | undefined): string | null {
  if (reason === undefined || reason === null || reason === '') {
    return null;
  }

  if (
    reason === 'auth_boundary' ||
    reason === 'payment_boundary' ||
    reason === 'manual_debug' ||
    reason === 'unknown_ui_state'
  ) {
    return reason;
  }

  throw new BrowserPlatformError('Invalid handoff reason', { code: 'INVALID_HANDOFF_REASON' });
}
