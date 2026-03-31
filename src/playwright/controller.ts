import path from 'node:path';
import { BrowserPlatformError } from '../core/errors.js';
import type { SessionActionPayload } from '../daemon/types.js';
import { BrowserSession, type BrowserSessionSnapshotResult, type PageStateSummary } from './browser-session.js';
import { buildActionResult, runStep } from '../runtime/run-step.js';

export class PlaywrightController {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(private readonly rootDir: string) {}

  async openSession(
    sessionId: string,
    url: string,
    options?: {
      storageStatePath?: string;
    }
  ): Promise<{ url: string; title: string }> {
    const session = new BrowserSession({
      sessionId,
      snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots'),
      storageStatePath: options?.storageStatePath
    });

    const opened = await session.open(url);
    this.sessions.set(sessionId, session);
    return opened;
  }

  async observeSession(sessionId: string): Promise<PageStateSummary> {
    return this.requireSession(sessionId).observe();
  }

  async actInSession(sessionId: string, payload: SessionActionPayload) {
    const session = this.requireSession(sessionId);
    const { before, after } = await runStep(session, payload);
    return buildActionResult(payload, before, after);
  }

  async snapshotSession(sessionId: string): Promise<BrowserSessionSnapshotResult> {
    return this.requireSession(sessionId).snapshot();
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.sessions.delete(sessionId);
    await session.close();
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    await Promise.all(sessionIds.map((sessionId) => this.closeSession(sessionId)));
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
    }

    return session;
  }
}
