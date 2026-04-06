import path from 'node:path';
import { BrowserPlatformError } from '../core/errors.js';
import type { SessionActionPayload } from '../daemon/types.js';
import { TraceWriter } from '../traces/writer.js';
import {
  BrowserContextPool,
  BrowserSession,
  type AdoptedBrowserSession,
  type BrowserSessionOpenResult,
  type BrowserSessionSnapshotResult,
  type PageStateSummary
} from './browser-session.js';
import { buildActionResult, runStep } from '../runtime/run-step.js';
import type { SessionBackend } from '../daemon/types.js';

export class PlaywrightController {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly traceWriter: TraceWriter;
  private readonly contextPool = new BrowserContextPool();

  constructor(private readonly rootDir: string) {
    this.traceWriter = new TraceWriter(path.join(this.rootDir, 'artifacts', 'traces'));
  }

  async openSession(
    sessionId: string,
    url: string,
    options?: {
      storageStatePath?: string;
      backend?: SessionBackend;
    }
  ): Promise<BrowserSessionOpenResult> {
    const session = new BrowserSession({
      sessionId,
      snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots'),
      storageStatePath: options?.storageStatePath,
      backend: options?.backend,
      contextPool: options?.storageStatePath ? this.contextPool : undefined
    });

    const opened = await session.open(url);
    this.sessions.set(sessionId, session);
    return opened;
  }

  async observeSession(sessionId: string): Promise<PageStateSummary> {
    return this.requireSession(sessionId).observe();
  }

  async adoptSession(
    sessionId: string,
    adopted: AdoptedBrowserSession,
    options?: {
      storageStatePath?: string;
      backend?: SessionBackend;
    }
  ): Promise<BrowserSessionOpenResult> {
    await this.closeSession(sessionId);

    const session = new BrowserSession({
      sessionId,
      snapshotRootDir: path.join(this.rootDir, 'artifacts', 'snapshots'),
      storageStatePath: options?.storageStatePath,
      backend: options?.backend
    });

    session.adoptExisting(adopted);
    await session.persistStorageState();
    const page = session.page();
    this.sessions.set(sessionId, session);

    return {
      url: page.url(),
      title: await page.title()
    };
  }

  async writeTrace(sessionId: string, stepType: string, payload: unknown) {
    return this.traceWriter.writeStep(sessionId, stepType, payload);
  }

  async actInSession(sessionId: string, payload: SessionActionPayload) {
    const session = this.requireSession(sessionId);
    const { before, after } = await runStep(session, payload);
    await session.persistStorageState();
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
    await this.contextPool.closeAll();
  }

  getSessionPage(sessionId: string): import('playwright').Page | null {
    return this.sessions.get(sessionId)?.page() ?? null;
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
    }

    return session;
  }
}
