import path from 'node:path';
import { BrowserPlatformError } from '../core/errors.js';
import type { SessionActionPayload } from '../daemon/types.js';
import { TraceWriter } from '../traces/writer.js';
import { isDebugEnabled, captureDebugStep, captureDebugStepJson } from '../debug/capture.js';
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
    await this.debugCapture(sessionId, 'open', { sessionId, url: opened.url, title: opened.title });
    return opened;
  }

  async observeSession(sessionId: string): Promise<PageStateSummary> {
    const result = await this.requireSession(sessionId).observe();
    await this.debugCapture(sessionId, 'observe', { sessionId, url: result.url, title: result.title });
    return result;
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
    const result = buildActionResult(payload, before, after);
    await this.debugCapture(sessionId, `act-${payload.action}`, {
      sessionId,
      action: result.action,
      target: result.target,
      input: result.input,
      before: { url: before.url, title: before.title },
      after: { url: after.url, title: after.title },
      changes: result.changes
    });
    return result;
  }

  async snapshotSession(sessionId: string): Promise<BrowserSessionSnapshotResult> {
    const result = await this.requireSession(sessionId).snapshot();
    if (isDebugEnabled()) {
      await captureDebugStepJson(this.rootDir, sessionId, 'snapshot', {
        sessionId,
        screenshotPath: result.screenshotPath,
        htmlPath: result.htmlPath,
        url: result.state.url,
        title: result.state.title
      });
    }
    return result;
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

  private async debugCapture(sessionId: string, stepName: string, meta: unknown): Promise<void> {
    if (!isDebugEnabled()) return;
    const page = this.sessions.get(sessionId)?.page();
    if (!page) return;
    await captureDebugStep(page, this.rootDir, sessionId, stepName, meta);
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserPlatformError('Session not found', { code: 'SESSION_NOT_FOUND' });
    }

    return session;
  }
}
