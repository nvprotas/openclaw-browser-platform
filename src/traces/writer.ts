import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface TraceArtifactRef {
  tracePath: string;
}

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:pass(?:word|code)?|pwd|otp|token|secret|cvv|cvc|pin|csrf|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token)/i;
const SENSITIVE_QUERY_PARAM_PATTERN = /([?&])((?:pass(?:word|code)?|pwd|otp|token|secret|cvv|cvc|pin|csrf|access[_-]?token|refresh[_-]?token|id[_-]?token))=([^&#\s"'<>]+)/gi;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function redactSensitiveQueryParams(value: string): string {
  return value.replace(SENSITIVE_QUERY_PARAM_PATTERN, (_match, prefix: string, key: string) => `${prefix}${key}=${REDACTED_VALUE}`);
}

function sanitizeTraceValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactSensitiveQueryParams(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTraceValue(item, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return REDACTED_VALUE;
  }
  seen.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key) || key === 'value') {
      sanitized[key] = REDACTED_VALUE;
      continue;
    }

    sanitized[key] = sanitizeTraceValue(nestedValue, seen);
  }

  return sanitized;
}

export function sanitizeTracePayload(payload: unknown): unknown {
  return sanitizeTraceValue(payload, new WeakSet<object>());
}

export class TraceWriter {
  constructor(private readonly rootDir: string) {}

  async writeStep(sessionId: string, stepType: string, payload: unknown): Promise<TraceArtifactRef> {
    const dir = path.join(this.rootDir, sessionId);
    await mkdir(dir, { recursive: true });
    const tracePath = path.join(dir, `${timestamp()}-${stepType}.json`);
    const sanitizedPayload = sanitizeTracePayload(payload);
    await writeFile(tracePath, `${JSON.stringify(sanitizedPayload, null, 2)}\n`, 'utf8');
    return { tracePath };
  }
}
