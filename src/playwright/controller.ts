import path from 'node:path';
import { BrowserPlatformError } from '../core/errors.js';
import { BrowserSession, type BrowserSessionSnapshotResult, type PageStateSummary } from './browser-session.js';

export class PlaywrightController {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(private readonly rootDir: string) {}

  async openSession(sessionId: string, url: string): Promise<{ url: string; title: string }> {
    const session = new BrowserSession({
      sessionId,
      snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots')
    });

    const opened = await session.open(url);
    this.sessions.set(sessionId, session);
    return opened;
  }

  async observeSession(sessionId: string): Promise<PageStateSummary> {
    return this.requireSession(sessionId).observe();
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
