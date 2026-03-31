import { BrowserPlatformError } from '../core/errors.js';

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function printErrorJson(error: unknown): void {
  if (error instanceof BrowserPlatformError) {
    printJson({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? null } });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  printJson({ ok: false, error: { code: 'UNEXPECTED_ERROR', message, details: null } });
}
