import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TraceWriter, sanitizeTracePayload } from '../../src/traces/writer.js';

describe('sanitizeTracePayload', () => {
  it('redacts secrets, tokens, OTP/CVV values, and form input values', () => {
    const payload = {
      event: 'handoff_started',
      sessionId: 'session-1',
      auth: {
        otp: '123456',
        password: 'correct horse battery staple',
        token: 'secret-token-1',
        nested: {
          cvc: '321',
          cvv: '777',
          secretNote: 'keep this private'
        }
      },
      input: {
        value: 'Sensitive form value',
        url: 'https://example.com/callback?token=abc123&orderId=42',
        key: 'Enter'
      },
      url: 'https://example.com/flow?access_token=abc123&next=/checkout',
      labels: ['visible text', 'plain note']
    };

    expect(sanitizeTracePayload(payload)).toEqual({
      event: 'handoff_started',
      sessionId: 'session-1',
      auth: {
        otp: '[REDACTED]',
        password: '[REDACTED]',
        token: '[REDACTED]',
        nested: {
          cvc: '[REDACTED]',
          cvv: '[REDACTED]',
          secretNote: '[REDACTED]'
        }
      },
      input: {
        value: '[REDACTED]',
        url: 'https://example.com/callback?token=[REDACTED]&orderId=42',
        key: 'Enter'
      },
      url: 'https://example.com/flow?access_token=[REDACTED]&next=/checkout',
      labels: ['visible text', 'plain note']
    });
  });
});

describe('TraceWriter', () => {
  it('writes sanitized trace artifacts to disk', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'trace-writer-test-'));
    const writer = new TraceWriter(rootDir);

    try {
      const trace = await writer.writeStep('session-redaction', 'handoff_started', {
        event: 'handoff_started',
        sessionId: 'session-redaction',
        reason: 'manual_debug',
        handoff: {
          active: true,
          reason: 'manual_debug',
          connect: {
            host: '127.0.0.1',
            port: 5901,
            url: 'https://example.com/connect?token=abc123',
            novncUrl: 'http://127.0.0.1:59101/v1/handoff/novnc/session-redaction'
          }
        },
        input: {
          value: '654321',
          key: 'Enter'
        }
      });

      const raw = await readFile(trace.tracePath, 'utf8');
      expect(raw).not.toContain('654321');
      expect(raw).not.toContain('token=abc123');
      expect(raw).toContain('[REDACTED]');

      expect(JSON.parse(raw)).toMatchObject({
        event: 'handoff_started',
        sessionId: 'session-redaction',
        reason: 'manual_debug',
        handoff: {
          active: true,
          reason: 'manual_debug',
          connect: {
            host: '127.0.0.1',
            port: 5901,
            url: 'https://example.com/connect?token=[REDACTED]',
            novncUrl: 'http://127.0.0.1:59101/v1/handoff/novnc/session-redaction'
          }
        },
        input: {
          value: '[REDACTED]',
          key: 'Enter'
        }
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
